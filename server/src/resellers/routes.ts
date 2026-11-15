import cookieParser from 'cookie-parser';
import express, { Router, type NextFunction, type Request, type Response } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import type { Auth } from '../auth';
import { allowOrigin, invalid } from '../auth/routes';
import { requireCsrf, requireSession } from '../auth/session';
import { buildView } from '../builds/start';
import type { Builds } from '../builds';
import type { Resellers } from './index';
import { brandView } from './index';
import ipaddr from 'ipaddr.js';
import { isPublicAddress } from '../url/address';
import { newSecret } from './callbacks';
import { quotaOf } from './quota';
import { activate, startPlanCheckout } from './billing';
import type { Payments } from '../payments/routes';
import { activeKeyCount, createKey, findKey, keyView, MAX_ACTIVE_KEYS, revokeKey } from './keys';

const notFound = (res: Response) => void res.status(404).json({ error: 'Not found' });
const keyBody = z.strictObject({ name: z.string().trim().min(1).max(40) });
const API_PER_MINUTE = 60;

/** The reseller who is signed in on the web, and may use the API. */
const ownReseller = (resellers: Resellers) => async (_req: Request, res: Response, next: NextFunction) => {
  const reseller = await resellers.resellers.findOne({ userId: res.locals.session.userId });
  if (!reseller || reseller.suspendedAt) return notFound(res);
  res.locals.reseller = reseller;
  next();
};

/** Public brand, plus a signed-in reseller's own key management. */
export const resellersRouter = (auth: Auth, resellers: Resellers, payments?: Payments) => {
  const router = Router();
  const csrf = requireCsrf(auth);

  router.get('/:slug/brand', async (req, res) => {
    if (req.params.slug === 'me') return notFound(res);
    const reseller = await resellers.resellers.findOne({ slug: String(req.params.slug).toLowerCase() });
    if (!reseller || reseller.suspendedAt) return notFound(res);
    res.set('Cache-Control', 'no-store').json(brandView(reseller));
  });

  const own = Router();
  own.use(allowOrigin(auth), cookieParser(), express.json({ limit: '2kb' }), requireSession(auth), ownReseller(resellers));
  own.get('/', async (_req, res) => {
    const reseller = res.locals.reseller;
    const plan = await resellers.plans.findOne({ _id: reseller.planId });
    res.set('Cache-Control', 'no-store').json({ brand: brandView(reseller), plan: { name: plan?.name ?? null }, quota: quotaOf(reseller), apiEnabled: Boolean(reseller.terms.api), lapsed: Boolean(reseller.lapsedAt), payment: { available: Boolean(payments?.providers.razorpay) && reseller.terms.priceMinor >= 100, priceMinor: reseller.terms.priceMinor, paidUntil: reseller.paidUntil ?? null } });
  });
  own.get('/keys', async (_req, res) => {
    const keys = await resellers.keys.find({ resellerId: res.locals.reseller._id }, { sort: { createdAt: -1 } }).toArray();
    res.json({ apiEnabled: Boolean(res.locals.reseller.terms.api), keys: keys.map(keyView) });
  });
  own.post('/keys', csrf, async (req, res) => {
    const { name } = keyBody.parse(req.body);
    if (!res.locals.reseller.terms.api) return void res.status(403).json({ error: 'The API is not part of this plan', reason: 'api_not_in_plan' });
    if ((await activeKeyCount(resellers, res.locals.reseller._id)) >= MAX_ACTIVE_KEYS) return void res.status(409).json({ error: `You can have up to ${MAX_ACTIVE_KEYS} active keys` });
    const { id, key, prefix } = await createKey(resellers, res.locals.reseller._id, name);
    // The one time the key is shown.
    res.status(201).set('Cache-Control', 'no-store').json({ id: String(id), key, prefix });
  });
  own.post('/keys/:id/revoke', csrf, async (req, res) => {
    if (!/^[0-9a-f]{24}$/.test(String(req.params.id))) return notFound(res);
    if (!(await revokeKey(resellers, res.locals.reseller._id, new ObjectId(String(req.params.id))))) return notFound(res);
    res.status(204).end();
  });
  const callbackBody = z.strictObject({ url: z.string().trim().max(500).url().refine((value) => value.startsWith('https://'), 'Must be https').or(z.literal('')) });
  own.get('/callback', (_req, res) => {
    const { callbackUrl, callbackSecret } = res.locals.reseller;
    res.set('Cache-Control', 'no-store').json({ url: callbackUrl ?? '', secret: callbackSecret ?? null });
  });
  own.post('/callback', csrf, async (req, res) => {
    const { url } = callbackBody.parse(req.body);
    // A name is checked again at every delivery; a bare address can be refused right now.
    const host = url ? new URL(url).hostname.replace(/^\[|\]$/g, '') : '';
    if (host && ipaddr.isValid(host) && !isPublicAddress(host)) return void res.status(400).json({ error: 'That address is not public' });
    const secret = res.locals.reseller.callbackSecret ?? newSecret();
    await resellers.resellers.updateOne({ _id: res.locals.reseller._id }, { $set: { callbackUrl: url, callbackSecret: secret } });
    res.set('Cache-Control', 'no-store').json({ url, secret });
  });
  own.post('/callback/rotate', csrf, async (_req, res) => {
    const secret = newSecret();
    await resellers.resellers.updateOne({ _id: res.locals.reseller._id }, { $set: { callbackSecret: secret } });
    res.set('Cache-Control', 'no-store').json({ secret });
  });
  if (payments) {
    /** Starts the payment for next month, or gives back the one already open. */
    own.post('/pay', csrf, async (_req, res) => {
      const key = `rate:reseller-pay:${String(res.locals.reseller._id)}`;
      const count = await auth.redis.incr(key);
      if (count === 1) await auth.redis.pexpire(key, 60 * 60 * 1000);
      if (count > 10) return void res.status(429).json({ error: 'Too many attempts, try again later' });
      const user = await auth.users.findOne({ _id: res.locals.reseller.userId });
      const result = await startPlanCheckout(resellers, payments, res.locals.reseller, String(user?.email ?? ''), auth.config.appUrl);
      if (!result.ok) return void res.status(result.status).json({ error: result.error });
      res.status(201).json(result.order);
    });

    /** After the modal succeeds the page sends the three values it returned. A signature that does not match marks nothing paid. */
    own.post('/pay/verify', csrf, async (req, res) => {
      const { razorpay_order_id: providerOrderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = req.body ?? {};
      if (![providerOrderId, paymentId, signature].every((value) => typeof value === 'string' && value.length > 0 && value.length < 200)) return void res.status(400).json({ error: 'Missing payment details' });
      const order = await resellers.orders.findOne({ provider: 'razorpay', providerOrderId, resellerId: res.locals.reseller._id });
      if (!order) return notFound(res);
      if (!payments.providers.razorpay?.verifyPayment?.(providerOrderId, paymentId, signature)) return void res.status(400).json({ error: 'Payment could not be verified' });
      await activate(resellers, order, paymentId);
      const reseller = await resellers.resellers.findOne({ _id: res.locals.reseller._id });
      res.json({ paid: (await resellers.orders.findOne({ _id: order._id }))?.status === 'paid', paidUntil: reseller?.paidUntil ?? null });
    });
  }
  router.use('/me', own);
  router.use(invalid);
  return router;
};

/** `/api/v1`: a reseller's key stands in for their login. `apps` is the apps router in its external form. */
export const apiRouter = (auth: Auth, resellers: Resellers, builds: Builds | undefined, apps: Router) => {
  const router = Router();

  router.use(async (req, res, next) => {
    const key = await findKey(resellers, req.header('authorization'));
    const reseller = key && (await resellers.resellers.findOne({ _id: key.resellerId }));
    if (!key || !reseller) return void res.status(401).json({ error: 'Invalid API key' });
    if (reseller.suspendedAt) return void res.status(403).json({ error: 'This reseller account is suspended', reason: 'reseller_suspended' });
    if (!reseller.terms.api) return void res.status(403).json({ error: 'The API is not part of this plan', reason: 'api_not_in_plan' });
    const rateKey = `rate:apikey:${String(key._id)}`;
    const count = await auth.redis.incr(rateKey);
    if (count === 1) await auth.redis.pexpire(rateKey, 60_000);
    if (count > API_PER_MINUTE) return void res.status(429).json({ error: 'Too many requests' });
    res.locals.session = { userId: reseller.userId };
    res.locals.reseller = reseller;
    next();
  });

  router.use('/apps', apps);
  if (builds) {
    router.get('/builds/:id', async (req, res) => {
      if (!/^[0-9a-f-]{36}$/.test(String(req.params.id))) return notFound(res);
      const build = await builds.builds.findOne({ _id: String(req.params.id) as never, ownerId: res.locals.reseller.userId });
      if (!build) return notFound(res);
      res.json(buildView(build));
    });
  }
  router.use((_req, res) => notFound(res));
  router.use(invalid);
  return router;
};
