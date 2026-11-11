import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyEvent } from '../src/payments/events';
import { reconcile } from '../src/payments/reconcile';
import { formatReceiptNo } from '../src/payments/receipts';
import { makeHarness, signedIn } from './auth-helpers';

type Harness = Awaited<ReturnType<typeof makeHarness>>;
let h: Harness;
beforeAll(async () => { h = await makeHarness(); });
afterAll(() => h.close());
const email = () => `u${Math.random().toString(36).slice(2)}@example.com`;

const buy = async (name = 'Shop') => {
  const address = email();
  const user = await signedIn(h, address);
  const app = await (await user.post('/apps', { appName: name })).json();
  const { id } = await (await user.post('/payments/checkout', { appId: app.id })).json();
  const providerOrderId = (await h.orders.findOne({ _id: new ObjectId(id) }))!.providerOrderId as string;
  const pay = () => applyEvent(h.payments, 'razorpay', { eventId: `p_${id}`, type: 'paid', providerOrderId, paymentId: `pay_${id}`, amount: 9900, currency: 'INR' }, 'x');
  return { user, address, appId: String(app.id), orderId: new ObjectId(id), id: String(id), pay };
};
const receiptMails = (to: string) => h.sent.filter((mail) => mail.to === to && /receipt/i.test(mail.subject));
const order = (id: ObjectId) => h.orders.findOne({ _id: id });

describe('AC13: a paid order gets a numbered receipt by email', () => {
  it('formats a number with a prefix and padding', () => {
    expect(formatReceiptNo(1)).toBe('R-000001');
    expect(formatReceiptNo(1234567)).toBe('R-1234567');
  });

  it('emails the buyer a plain receipt with the number, app, amount, currency and date', async () => {
    const { address, orderId, pay } = await buy('My Shop');
    await pay();
    const mail = receiptMails(address)[0]!;
    const stored = (await order(orderId))!;
    expect(stored.receiptNo).toMatch(/^R-\d{6,}$/);
    expect(mail.subject).toContain(stored.receiptNo);
    for (const part of [stored.receiptNo, 'My Shop', '₹99', 'INR', address, String(new Date(stored.paidAt).getUTCFullYear())]) expect(mail.text).toContain(part);
  });

  it('is a receipt and not a tax invoice, with no tax line or GSTIN', async () => {
    const { address, pay } = await buy();
    await pay();
    const text = receiptMails(address)[0]!.text;
    expect(text).toMatch(/not a tax invoice/i);
    expect(text).not.toMatch(/GSTIN|CGST|SGST|IGST/);
  });

  it('numbers receipts one after another with no repeats, even when paid at once', async () => {
    const buyers = await Promise.all([1, 2, 3, 4, 5].map(() => buy()));
    await Promise.all(buyers.map((b) => b.pay()));
    const numbers = (await Promise.all(buyers.map(async (b) => Number(((await order(b.orderId))!.receiptNo as string).slice(2))))).sort((a, b) => a - b);
    expect(new Set(numbers).size).toBe(5);
    expect(numbers.at(-1)! - numbers[0]!).toBe(4);
  });

  it('sends one receipt however often the payment is reported', async () => {
    const { address, pay, orderId } = await buy();
    await pay();
    await pay();
    await reconcile(h.payments);
    expect(receiptMails(address)).toHaveLength(1);
    expect((await order(orderId))?.receiptEmailedAt).toBeInstanceOf(Date);
  });

  it('sends no receipt for an unpaid or mismatched order', async () => {
    const { address, providerOrderId } = await (async () => {
      const b = await buy();
      return { address: b.address, providerOrderId: (await order(b.orderId))!.providerOrderId as string };
    })();
    await applyEvent(h.payments, 'razorpay', { eventId: 'mm', type: 'paid', providerOrderId, paymentId: 'p', amount: 1, currency: 'INR' }, 'x');
    expect(receiptMails(address)).toHaveLength(0);
  });
});

describe('a receipt survives a cut-off', () => {
  it('issues and sends a receipt the sweep finds missing', async () => {
    const { address, orderId } = await buy();
    await h.orders.updateOne({ _id: orderId }, { $set: { status: 'paid', paidAt: new Date(), paymentId: 'pay_x' } });
    await reconcile(h.payments);
    expect((await order(orderId))?.receiptNo).toMatch(/^R-/);
    expect(receiptMails(address)).toHaveLength(1);
  });

  it('retries an email that failed, without a second number', async () => {
    const { address, orderId, pay } = await buy();
    const original = h.payments.mailer!.send;
    h.payments.mailer!.send = async () => { throw new Error('Resend answered 500'); };
    await pay();
    h.payments.mailer!.send = original;
    const number = (await order(orderId))?.receiptNo;
    expect(number).toBeDefined();
    expect(receiptMails(address)).toHaveLength(0);
    await reconcile(h.payments);
    expect(receiptMails(address)).toHaveLength(1);
    expect((await order(orderId))?.receiptNo).toBe(number);
  });

  it('still unlocks the app when the email fails', async () => {
    const { appId, pay } = await buy();
    h.payments.mailer!.send = async () => { throw new Error('down'); };
    await pay();
    expect((await h.apps.findOne({ _id: new ObjectId(appId) }))?.plan).toBe('premium');
  });
});

describe('AC13: receipts in the buyer\'s account', () => {
  it('lists and shows the buyer\'s own receipts, and nobody else\'s', async () => {
    const { user, orderId, id, pay } = await buy('Listed');
    await pay();
    const list = await (await user.get('/payments/receipts')).json();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id, receiptNo: (await order(orderId))!.receiptNo, appName: 'Listed', amount: 9900, currency: 'INR', tax: null });
    const one = await user.get(`/payments/receipts/${id}`);
    expect((await one.json()).receiptNo).toBe(list[0].receiptNo);
    const stranger = await signedIn(h, email());
    expect(await (await stranger.get('/payments/receipts')).json()).toEqual([]);
    expect((await stranger.get(`/payments/receipts/${id}`)).status).toBe(404);
  });

  it('does not list unpaid orders and needs a session', async () => {
    const { user } = await buy();
    expect(await (await user.get('/payments/receipts')).json()).toEqual([]);
    expect((await fetch(`${h.url}/payments/receipts`)).status).toBe(401);
  });

  it('keeps a receipt readable after a refund', async () => {
    const { user, id, orderId, pay } = await buy('Refunded');
    await pay();
    await h.orders.updateOne({ _id: orderId }, { $set: { status: 'refunded' } });
    const list = await (await user.get('/payments/receipts')).json();
    expect(list[0]).toMatchObject({ id, status: 'refunded' });
  });
});
