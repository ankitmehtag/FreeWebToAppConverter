import { describe, expect, it } from 'vitest';
import { razorpay } from '../src/payments/razorpay';

type Call = { url: string; init: RequestInit };
const fakeFetch = (reply: unknown, status = 200) => {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(reply), { status });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
};
const input = { orderId: 'ord_1', amount: 9900, currency: 'INR' as const, description: 'Premium for Mine', customerEmail: 'a@example.com', returnUrl: 'https://app.test/pay/return?order=ord_1' };

describe('AC1: Razorpay checkout is a hosted payment link', () => {
  it('creates a payment link with the order id, amount and currency, signed with the key pair', async () => {
    const { calls, fetchImpl } = fakeFetch({ id: 'plink_1', short_url: 'https://rzp.io/i/abc', status: 'created' });
    const result = await razorpay({ keyId: 'rzp_test_id', keySecret: 'secret', fetchImpl }).createCheckout(input);
    expect(result).toEqual({ providerOrderId: 'plink_1', checkoutUrl: 'https://rzp.io/i/abc' });
    expect(calls[0]!.url).toBe('https://api.razorpay.com/v1/payment_links');
    expect(calls[0]!.init.method).toBe('POST');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Basic ${Buffer.from('rzp_test_id:secret').toString('base64')}`);
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body).toMatchObject({ amount: 9900, currency: 'INR', reference_id: 'ord_1', callback_url: input.returnUrl, accept_partial: false });
    expect(body.customer.email).toBe('a@example.com');
    expect(body.notes.orderId).toBe('ord_1');
  });

  it('never sends the key secret or card fields in the body', async () => {
    const { calls, fetchImpl } = fakeFetch({ id: 'plink_1', short_url: 'https://rzp.io/i/abc' });
    await razorpay({ keyId: 'rzp_test_id', keySecret: 'topsecret', fetchImpl }).createCheckout(input);
    expect(String(calls[0]!.init.body)).not.toContain('topsecret');
  });

  it('refuses a currency Razorpay is not used for', async () => {
    const { fetchImpl, calls } = fakeFetch({});
    await expect(razorpay({ keyId: 'k', keySecret: 's', fetchImpl }).createCheckout({ ...input, currency: 'USD' })).rejects.toThrow(/INR/);
    expect(calls).toHaveLength(0);
  });

  it('fails clearly, without leaking the reply, when Razorpay answers an error', async () => {
    const { fetchImpl } = fakeFetch({ error: { description: 'Authentication failed' } }, 401);
    await expect(razorpay({ keyId: 'k', keySecret: 's', fetchImpl }).createCheckout(input)).rejects.toThrow('Razorpay answered 401');
  });

  it('fails when the reply has no link', async () => {
    const { fetchImpl } = fakeFetch({ id: 'plink_1' });
    await expect(razorpay({ keyId: 'k', keySecret: 's', fetchImpl }).createCheckout(input)).rejects.toThrow(/link/);
  });
});

describe('AC1: the status comes from Razorpay, not the redirect', () => {
  const status = async (reply: object) => razorpay({ keyId: 'k', keySecret: 's', fetchImpl: fakeFetch(reply).fetchImpl }).fetchStatus('plink_1');

  it('reads a paid link with its amount, currency and payment id', async () => {
    expect(await status({ status: 'paid', amount: 9900, currency: 'INR', amount_paid: 9900, payments: [{ payment_id: 'pay_1', status: 'captured' }] })).toEqual({
      status: 'paid', amount: 9900, currency: 'INR', paymentId: 'pay_1',
    });
  });

  it('is not paid when the amount paid is short, even if the status says paid', async () => {
    expect((await status({ status: 'paid', amount: 9900, currency: 'INR', amount_paid: 100, payments: [{ payment_id: 'pay_1' }] })).status).toBe('created');
  });

  it('maps a created, partially paid, expired or cancelled link', async () => {
    expect((await status({ status: 'created', amount: 9900, currency: 'INR' })).status).toBe('created');
    expect((await status({ status: 'partially_paid', amount: 9900, currency: 'INR' })).status).toBe('created');
    expect((await status({ status: 'expired', amount: 9900, currency: 'INR' })).status).toBe('expired');
    expect((await status({ status: 'cancelled', amount: 9900, currency: 'INR' })).status).toBe('expired');
  });

  it('asks for the right link', async () => {
    const { calls, fetchImpl } = fakeFetch({ status: 'created', amount: 9900, currency: 'INR' });
    await razorpay({ keyId: 'k', keySecret: 's', fetchImpl }).fetchStatus('plink_9');
    expect(calls[0]!.url).toBe('https://api.razorpay.com/v1/payment_links/plink_9');
    expect(calls[0]!.init.method ?? 'GET').toBe('GET');
  });
});
