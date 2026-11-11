import cookieParser from 'cookie-parser';
import express, { Router } from 'express';
import { ObjectId, type Collection, type Document } from 'mongodb';
import type { Auth } from '../auth';
import { allowOrigin } from '../auth/routes';
import { requireCsrf, requireSession } from '../auth/session';
import { planOf } from '../apps/plan';
import type { prepareOrders } from './orders';
import { isCurrency, premiumPrice, type Currency } from './prices';
import type { PaymentProvider, ProviderName } from './provider';

export type Payments = Awaited<ReturnType<typeof prepareOrders>> & {
  apps: Collection<Document>;
  users: Collection<Document>;
  /** Where Premium keys live and where builds are kept. A refund revokes the key and checks for downloads. */
  keystores?: Collection<Document>;
  builds?: Collection<Document>;
  /** Only providers with keys set. INR goes to Razorpay; USD waits for Stripe. */
  providers: Partial<Record<ProviderName, PaymentProvider>>;
};

const PROVIDER_FOR: Record<Currency, ProviderName> = { INR: 'razorpay', USD: 'stripe' };
const CHECKOUTS_PER_HOUR = 10;

export const paymentsRouter = (auth: Auth, payments: Payments) => {
  const { orders, apps, users, providers } = payments;
  const router = Router();
  const csrf = requireCsrf(auth);
  router.use(allowOrigin(auth), cookieParser(), express.json({ limit: '1kb' }));

  const available = () => (Object.keys(PROVIDER_FOR) as Currency[]).filter((currency) => providers[PROVIDER_FOR[currency]]);

  /** Public: the Pricing page asks the server what Premium costs and where it can be bought. */
  router.get('/prices', (_req, res) => {
    res.json({ premium: { INR: premiumPrice('INR'), USD: premiumPrice('USD') }, available: available() });
  });

  router.use(requireSession(auth));
  const userOf = (res: express.Response) => res.locals.session.userId as ObjectId;
  const view = (order: Document) => ({
    id: String(order._id),
    appId: String(order.appId),
    plan: order.plan,
    status: order.status,
    currency: order.currency,
    amount: order.amount,
  });

  router.post('/checkout', csrf, async (req, res) => {
    const userId = userOf(res);
    // Counted before anything else, so bad requests use up the allowance too.
    const key = `rate:checkout:${userId}`;
    const count = await auth.redis.incr(key);
    if (count === 1) await auth.redis.pexpire(key, 60 * 60 * 1000);
    if (count > CHECKOUTS_PER_HOUR) return res.status(429).json({ error: 'Too many attempts, try again later' });

    const appId = typeof req.body?.appId === 'string' && /^[0-9a-f]{24}$/.test(req.body.appId) ? new ObjectId(req.body.appId) : null;
    const currency = req.body?.currency ?? 'INR';
    if (!appId || !isCurrency(currency)) return res.status(400).json({ error: 'Choose an app and a currency' });

    // Another person's app and a missing one look the same, and neither leaves an order behind.
    const app = await apps.findOne({ _id: appId, ownerId: userId });
    if (!app) return res.status(404).json({ error: 'App not found' });
    if (planOf(app) === 'premium') return res.status(409).json({ error: 'This app is already Premium' });

    const open = await orders.findOne({ appId, status: { $in: ['created', 'pending', 'paid'] } });
    const reuse = (order: Document) => {
      if (order.status === 'paid') return res.status(409).json({ error: 'This app is already paid for' });
      if (!order.checkoutUrl) return res.status(409).json({ error: 'Checkout is starting, try again in a moment' });
      return res.json({ ...view(order), checkoutUrl: order.checkoutUrl });
    };
    if (open) return reuse(open);

    const providerName = PROVIDER_FOR[currency];
    const provider = providers[providerName];
    if (!provider) return res.status(400).json({ error: `Payment in ${currency} is not available yet` });

    const user = await users.findOne({ _id: userId });
    const order = {
      _id: new ObjectId(),
      appId,
      userId,
      plan: 'premium',
      provider: providerName,
      currency,
      amount: premiumPrice(currency),
      status: 'created',
      createdAt: new Date(),
    };
    try {
      await orders.insertOne(order);
    } catch (error) {
      // Two requests at once: the index let only one in, so the other reuses it.
      if ((error as { code?: number }).code !== 11000) throw error;
      const winner = await orders.findOne({ appId, status: { $in: ['created', 'pending', 'paid'] } });
      return winner ? reuse(winner) : res.status(409).json({ error: 'Checkout is starting, try again in a moment' });
    }

    try {
      const checkout = await provider.createCheckout({
        orderId: String(order._id),
        amount: order.amount,
        currency,
        description: 'Premium for one app',
        customerEmail: String(user?.email ?? ''),
        returnUrl: `${auth.config.appUrl}/pay/return?order=${order._id}`,
      });
      await orders.updateOne({ _id: order._id }, { $set: { providerOrderId: checkout.providerOrderId, checkoutUrl: checkout.checkoutUrl } });
      res.status(201).json({ ...view(order), checkoutUrl: checkout.checkoutUrl });
    } catch (error) {
      // Free the app for another try. The message stays out of the reply, as it can carry request details.
      await orders.updateOne({ _id: order._id }, { $set: { status: 'failed', failedAt: new Date() } });
      console.error('Checkout failed', error instanceof Error ? error.message : 'unknown');
      res.status(502).json({ error: 'The payment provider is not answering, try again soon' });
    }
  });

  /** The real status, read from our records, not from the redirect (R7). */
  router.get('/orders/:id', async (req, res) => {
    const id = String(req.params.id);
    const order = /^[0-9a-f]{24}$/.test(id) && (await orders.findOne({ _id: new ObjectId(id), userId: userOf(res) }));
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.set('Cache-Control', 'no-store').json(view(order));
  });

  return router;
};
