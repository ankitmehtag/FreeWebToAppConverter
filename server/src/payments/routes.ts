import cookieParser from 'cookie-parser';
import express, { Router } from 'express';
import { ObjectId, type Collection, type Document } from 'mongodb';
import type { Auth } from '../auth';
import { allowOrigin } from '../auth/routes';
import { requireCsrf, requireSession } from '../auth/session';
import { planOf } from '../apps/plan';
import type { prepareOrders } from './orders';
import { receiptView } from './receipts';
import type { Mailer } from '../auth/types';
import { applyEvent } from './events';
import { discounted, findUsable, normalizeCode, redeem, releaseCoupon } from './coupons';
import { isCurrency, premiumPrice, type Currency } from './prices';
import { markPaid } from './unlock';
import type { PaymentProvider, ProviderName } from './provider';

export type Payments = Awaited<ReturnType<typeof prepareOrders>> & {
  apps: Collection<Document>;
  users: Collection<Document>;
  /** Where Premium keys live and where builds are kept. A refund revokes the key and checks for downloads. */
  keystores?: Collection<Document>;
  builds?: Collection<Document>;
  /** Sends receipts. Without one, receipts are still numbered and shown in the account. */
  mailer?: Mailer;
  /** Only providers with keys set. INR goes to Razorpay; USD waits for Stripe. */
  providers: Partial<Record<ProviderName, PaymentProvider>>;
};

const PROVIDER_FOR: Record<Currency, ProviderName> = { INR: 'razorpay', USD: 'stripe' };
const CHECKOUTS_PER_HOUR = 10;

export const paymentsRouter = (auth: Auth, payments: Payments) => {
  const { orders, apps, users, providers, coupons } = payments;
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

  /** What a coupon would take off, so the page can show the price before the buyer commits. */
  router.post('/coupon', csrf, async (req, res) => {
    const userId = userOf(res);
    const key = `rate:coupon:${userId}`;
    const count = await auth.redis.incr(key);
    if (count === 1) await auth.redis.pexpire(key, 60 * 60 * 1000);
    if (count > 30) return res.status(429).json({ error: 'Too many attempts, try again later' });
    const currency = req.body?.currency ?? 'INR';
    const coupon = isCurrency(currency) ? await findUsable(coupons, normalizeCode(req.body?.code), 'premium') : null;
    const amount = coupon && isCurrency(currency) ? discounted(coupon, premiumPrice(currency), currency) : undefined;
    // One answer for a wrong, expired, used-up and inapplicable code, so codes cannot be probed.
    if (amount === undefined || !isCurrency(currency)) return res.status(404).json({ error: 'That code doesn’t work' });
    res.json({ code: coupon!.code, currency, amount });
  });

  /** What the page needs to take the payment: the provider's modal (public key and order id) or a hosted page to open. */
  const checkoutOf = (order: Document) => ({
    provider: order.provider,
    keyId: order.keyId ?? null,
    orderId: order.providerOrderId,
    amount: order.amount,
    currency: order.currency,
    checkoutUrl: order.checkoutUrl ?? null,
  });

  /**
   * After the modal succeeds the page sends the three values it returned. A signature that does not match marks nothing paid.
   * The order's own amount is used, not anything the page says; the webhook and the sweep remain the backstop.
   */
  router.post('/verify', csrf, async (req, res) => {
    const { razorpay_order_id: providerOrderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = req.body ?? {};
    if (![providerOrderId, paymentId, signature].every((value) => typeof value === 'string' && value.length > 0 && value.length < 200)) {
      return res.status(400).json({ error: 'Missing payment details' });
    }
    const order = await orders.findOne({ provider: 'razorpay', providerOrderId, userId: userOf(res) });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    const provider = providers.razorpay;
    if (!provider?.verifyPayment?.(providerOrderId, paymentId, signature)) return res.status(400).json({ error: 'Payment could not be verified' });
    await applyEvent(payments, 'razorpay', { eventId: `verify:${paymentId}`, type: 'paid', providerOrderId, paymentId, amount: order.amount, currency: order.currency }, 'verify');
    res.json(view((await orders.findOne({ _id: order._id }))!));
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
      if (!order.providerOrderId) return res.status(409).json({ error: 'Checkout is starting, try again in a moment' });
      return res.json({ ...view(order), checkout: checkoutOf(order) });
    };
    if (open) return reuse(open);

    // A coupon is read first to price the order, then taken atomically once the order holds the app.
    const code = normalizeCode(req.body?.couponCode);
    const coupon = code ? await findUsable(coupons, code, 'premium') : null;
    const listPrice = premiumPrice(currency);
    const amount = coupon ? discounted(coupon, listPrice, currency) : listPrice;
    if (code && (!coupon || amount === undefined)) return res.status(400).json({ error: 'That code doesn’t work' });
    const price = amount as number;
    const free = price === 0;
    // Providers refuse tiny charges, so a coupon may take a price to nothing or leave a real one.
    if (!free && price < 100) return res.status(400).json({ error: 'That code doesn’t work' });

    const providerName = PROVIDER_FOR[currency];
    const provider = providers[providerName];
    if (!free && !provider) return res.status(400).json({ error: `Payment in ${currency} is not available yet` });

    const user = await users.findOne({ _id: userId });
    const order = {
      _id: new ObjectId(),
      appId,
      userId,
      plan: 'premium',
      provider: free ? 'coupon' : providerName,
      currency,
      amount: price,
      status: 'created',
      createdAt: new Date(),
      ...(coupon ? { couponCode: code, couponId: coupon._id, listAmount: listPrice } : {}),
    };
    try {
      await orders.insertOne(order);
    } catch (error) {
      // Two requests at once: the index let only one in, so the other reuses it.
      if ((error as { code?: number }).code !== 11000) throw error;
      const winner = await orders.findOne({ appId, status: { $in: ['created', 'pending', 'paid'] } });
      return winner ? reuse(winner) : res.status(409).json({ error: 'Checkout is starting, try again in a moment' });
    }

    if (coupon) {
      if (!(await redeem(coupons, coupon, userId))) {
        await orders.updateOne({ _id: order._id }, { $set: { status: 'failed', failedAt: new Date() } });
        return res.status(409).json({ error: 'That code has been used up' });
      }
      await orders.updateOne({ _id: order._id }, { $set: { couponRedeemed: true } });
    }

    if (free) {
      // Through the same unlock as a payment, so it shows in the records, with no provider call.
      await markPaid(payments, order);
      return res.status(201).json({ ...view({ ...order, status: 'paid' }), checkout: null });
    }

    try {
      const checkout = await provider!.createCheckout({
        orderId: String(order._id),
        amount: order.amount,
        currency,
        description: 'Premium for one app',
        customerEmail: String(user?.email ?? ''),
        returnUrl: `${auth.config.appUrl}/pay/return?order=${order._id}`,
      });
      const kept = { providerOrderId: checkout.providerOrderId, ...(checkout.keyId ? { keyId: checkout.keyId } : {}), ...(checkout.checkoutUrl ? { checkoutUrl: checkout.checkoutUrl } : {}) };
      await orders.updateOne({ _id: order._id }, { $set: kept });
      res.status(201).json({ ...view(order), checkout: checkoutOf({ ...order, ...kept }) });
    } catch (error) {
      // Free the app for another try, and give the coupon use back. The message stays out of the reply, as it can carry request details.
      await orders.updateOne({ _id: order._id }, { $set: { status: 'failed', failedAt: new Date() } });
      await releaseCoupon(payments, { ...order, couponRedeemed: true });
      console.error('Checkout failed', error instanceof Error ? error.message : 'unknown');
      res.status(502).json({ error: 'The payment provider is not answering, try again soon' });
    }
  });


  /** The buyer's receipts, newest first. They stay after a refund and after the app is gone. */
  router.get('/receipts', async (_req, res) => {
    const list = await orders.find({ userId: userOf(res), receiptNo: { $exists: true } }).sort({ paidAt: -1 }).toArray();
    res.set('Cache-Control', 'no-store').json(list.map(receiptView));
  });

  router.get('/receipts/:id', async (req, res) => {
    const id = String(req.params.id);
    const order = /^[0-9a-f]{24}$/.test(id) && (await orders.findOne({ _id: new ObjectId(id), userId: userOf(res), receiptNo: { $exists: true } }));
    if (!order) return res.status(404).json({ error: 'Receipt not found' });
    res.set('Cache-Control', 'no-store').json(receiptView(order));
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
