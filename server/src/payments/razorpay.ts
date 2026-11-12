import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PaymentProvider, ProviderStatus, WebhookEvent } from './provider';

const API = 'https://api.razorpay.com/v1';

const header = (headers: Record<string, string | string[] | undefined>, name: string) => {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
};

type Entity = Record<string, unknown>;
const entity = (payload: unknown, key: string): Entity | undefined =>
  ((payload as { payload?: Record<string, { entity?: Entity }> })?.payload ?? {})[key]?.entity;

/** Checks X-Razorpay-Signature, an HMAC-SHA256 of the raw body, then maps the event. Null when the signature is missing or wrong. */
export const verifyRazorpayWebhook = (
  secret: string | undefined,
  rawBody: Buffer,
  headers: Record<string, string | string[] | undefined>,
): WebhookEvent | null => {
  const signature = header(headers, 'x-razorpay-signature');
  const eventId = header(headers, 'x-razorpay-event-id');
  if (!secret || !signature || !eventId) return null;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  const given = Buffer.from(signature, 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  let body: { event?: string };
  try {
    body = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return { eventId, type: 'ignored' };
  }
  const order = entity(body, 'order');
  const payment = entity(body, 'payment');
  const refund = entity(body, 'refund');
  switch (body.event) {
    case 'order.paid':
      return {
        eventId,
        type: 'paid',
        providerOrderId: order?.id as string | undefined,
        paymentId: (payment?.id ?? undefined) as string | undefined,
        amount: Number(order?.amount_paid ?? payment?.amount),
        currency: String(order?.currency ?? payment?.currency),
      };
    case 'refund.processed':
      return { eventId, type: 'refunded', paymentId: refund?.payment_id as string | undefined, amount: Number(refund?.amount) };
    case 'payment.dispute.lost':
      return { eventId, type: 'disputed', paymentId: ((entity(body, 'dispute') ?? payment)?.payment_id ?? payment?.id) as string | undefined };
    default:
      return { eventId, type: 'ignored' };
  }
};

type Options = { keyId: string; keySecret: string; webhookSecret?: string; fetchImpl?: typeof fetch };

/** Razorpay through hosted Payment Links, so the buyer pays on Razorpay's page and we never see a card. */
export const razorpay = ({ keyId, keySecret, webhookSecret, fetchImpl = fetch }: Options): PaymentProvider => {
  const authorization = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`;

  const call = async (path: string, body?: object) => {
    const response = await fetchImpl(`${API}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { authorization, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    // The reply can echo the request, so only the status goes into the error.
    if (!response.ok) throw new Error(`Razorpay answered ${response.status}`);
    return (await response.json()) as Record<string, unknown>;
  };

  return {
    name: 'razorpay',

    verifyWebhook: (rawBody, headers) => verifyRazorpayWebhook(webhookSecret, rawBody, headers),

    verifyPayment(providerOrderId, paymentId, signature) {
      const expected = createHmac('sha256', keySecret).update(`${providerOrderId}|${paymentId}`).digest();
      const given = Buffer.from(signature, 'hex');
      return given.length === expected.length && timingSafeEqual(given, expected);
    },

    async createCheckout(input) {
      if (input.currency !== 'INR') throw new Error('Razorpay is used for INR only');
      const order = await call('/orders', {
        amount: input.amount,
        currency: input.currency,
        receipt: input.orderId,
        notes: { orderId: input.orderId },
      });
      if (typeof order.id !== 'string') throw new Error('Razorpay sent no order id');
      // The page opens Razorpay's modal with this id and the public key. The secret never leaves the server.
      return { providerOrderId: order.id, keyId };
    },

    async refund(paymentId, amount) {
      const refund = await call(`/payments/${encodeURIComponent(paymentId)}/refund`, { amount });
      if (typeof refund.id !== 'string') throw new Error('Razorpay sent no refund id');
      return { refundId: refund.id };
    },

    async fetchStatus(providerOrderId): Promise<ProviderStatus> {
      const order = await call(`/orders/${encodeURIComponent(providerOrderId)}`);
      const amount = Number(order.amount);
      const currency = String(order.currency);
      // Paid only if the full amount came in, whatever the label says.
      if (order.status !== 'paid' || Number(order.amount_paid) < amount) return { status: 'created', amount, currency };
      const payments = await call(`/orders/${encodeURIComponent(providerOrderId)}/payments`);
      const items = Array.isArray(payments.items) ? (payments.items as { id?: string; status?: string }[]) : [];
      const paymentId = items.find((item) => item.status === 'captured' && typeof item.id === 'string')?.id;
      return { status: 'paid', amount, currency, paymentId };
    },
  };
};
