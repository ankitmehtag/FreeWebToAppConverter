import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { razorpay } from '../src/payments/razorpay';

type Call = { url: string; init: RequestInit };
/** Answers each call in turn with the next reply. */
const fakeFetch = (...replies: [unknown, number?][]) => {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const [reply, status = 200] = replies[Math.min(calls.length - 1, replies.length - 1)]!;
    return new Response(JSON.stringify(reply), { status });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
};
const input = { orderId: 'ord_1', amount: 9900, currency: 'INR' as const, description: 'Premium for Mine', customerEmail: 'a@example.com', returnUrl: 'https://app.test/pay/return?order=ord_1' };
const make = (fetchImpl: typeof fetch) => razorpay({ keyId: 'rzp_test_id', keySecret: 'secret', fetchImpl });

describe('AC1: Razorpay checkout is an order for the modal', () => {
  it('creates an order with the amount, currency and our order id as receipt, signed with the key pair', async () => {
    const { calls, fetchImpl } = fakeFetch([{ id: 'order_1', status: 'created' }]);
    const result = await make(fetchImpl).createCheckout(input);
    expect(result).toEqual({ providerOrderId: 'order_1', keyId: 'rzp_test_id' });
    expect(calls[0]!.url).toBe('https://api.razorpay.com/v1/orders');
    expect(calls[0]!.init.method).toBe('POST');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe(`Basic ${Buffer.from('rzp_test_id:secret').toString('base64')}`);
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({ amount: 9900, currency: 'INR', receipt: 'ord_1', notes: { orderId: 'ord_1' } });
  });

  it('never sends the key secret, and never hands it back', async () => {
    const { calls, fetchImpl } = fakeFetch([{ id: 'order_1' }]);
    const result = await razorpay({ keyId: 'rzp_test_id', keySecret: 'topsecret', fetchImpl }).createCheckout(input);
    expect(String(calls[0]!.init.body)).not.toContain('topsecret');
    expect(JSON.stringify(result)).not.toContain('topsecret');
  });

  it('refuses a currency Razorpay is not used for', async () => {
    const { fetchImpl, calls } = fakeFetch([{}]);
    await expect(make(fetchImpl).createCheckout({ ...input, currency: 'USD' })).rejects.toThrow(/INR/);
    expect(calls).toHaveLength(0);
  });

  it('fails clearly, without leaking the reply, when Razorpay answers an error', async () => {
    const { fetchImpl } = fakeFetch([{ error: { description: 'Authentication failed' } }, 401]);
    await expect(make(fetchImpl).createCheckout(input)).rejects.toThrow('Razorpay answered 401');
  });

  it('fails when the reply has no order id', async () => {
    const { fetchImpl } = fakeFetch([{ status: 'created' }]);
    await expect(make(fetchImpl).createCheckout(input)).rejects.toThrow(/order id/);
  });
});

describe('AC1: the modal\'s result is checked with the key secret', () => {
  const signature = (orderId: string, paymentId: string, secret = 'secret') => createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
  const verify = (orderId: string, paymentId: string, given: string) => make(fakeFetch([{}]).fetchImpl).verifyPayment!(orderId, paymentId, given);

  it('accepts the signature of order_id|payment_id', () => {
    expect(verify('order_1', 'pay_1', signature('order_1', 'pay_1'))).toBe(true);
  });

  it('rejects another order, another payment, another secret, a short or non-hex value', () => {
    expect(verify('order_2', 'pay_1', signature('order_1', 'pay_1'))).toBe(false);
    expect(verify('order_1', 'pay_2', signature('order_1', 'pay_1'))).toBe(false);
    expect(verify('order_1', 'pay_1', signature('order_1', 'pay_1', 'other'))).toBe(false);
    expect(verify('order_1', 'pay_1', 'abcd')).toBe(false);
    expect(verify('order_1', 'pay_1', 'zz')).toBe(false);
  });
});

describe('AC1: the status comes from Razorpay, not the redirect', () => {
  it('reads a paid order with its amount, currency and captured payment id', async () => {
    const { calls, fetchImpl } = fakeFetch(
      [{ status: 'paid', amount: 9900, currency: 'INR', amount_paid: 9900 }],
      [{ items: [{ id: 'pay_failed', status: 'failed' }, { id: 'pay_1', status: 'captured' }] }],
    );
    expect(await make(fetchImpl).fetchStatus('order_9')).toEqual({ status: 'paid', amount: 9900, currency: 'INR', paymentId: 'pay_1' });
    expect(calls.map((call) => call.url)).toEqual(['https://api.razorpay.com/v1/orders/order_9', 'https://api.razorpay.com/v1/orders/order_9/payments']);
  });

  it('is not paid when the amount paid is short, even if the status says paid', async () => {
    const { fetchImpl } = fakeFetch([{ status: 'paid', amount: 9900, currency: 'INR', amount_paid: 100 }]);
    expect((await make(fetchImpl).fetchStatus('order_1')).status).toBe('created');
  });

  it('keeps waiting for a created or attempted order', async () => {
    for (const status of ['created', 'attempted']) {
      const { fetchImpl } = fakeFetch([{ status, amount: 9900, currency: 'INR', amount_paid: 0 }]);
      expect((await make(fetchImpl).fetchStatus('order_1')).status).toBe('created');
    }
  });
});
