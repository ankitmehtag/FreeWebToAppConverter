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
  const link = entity(body, 'payment_link');
  const payment = entity(body, 'payment');
  const refund = entity(body, 'refund');
  switch (body.event) {
    case 'payment_link.paid':
      return {
        eventId,
        type: 'paid',
        providerOrderId: link?.id as string | undefined,
        paymentId: (payment?.id ?? undefined) as string | undefined,
        amount: Number(link?.amount_paid ?? payment?.amount),
        currency: String(link?.currency ?? payment?.currency),
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

    async createCheckout(input) {
      if (input.currency !== 'INR') throw new Error('Razorpay is used for INR only');
      const link = await call('/payment_links', {
        amount: input.amount,
        currency: input.currency,
        description: input.description,
        reference_id: input.orderId,
        customer: { email: input.customerEmail },
        notify: { email: false, sms: false },
        callback_url: input.returnUrl,
        callback_method: 'get',
        accept_partial: false,
        notes: { orderId: input.orderId },
      });
      if (typeof link.id !== 'string' || typeof link.short_url !== 'string') throw new Error('Razorpay sent no payment link');
      return { providerOrderId: link.id, checkoutUrl: link.short_url };
    },

    async fetchStatus(providerOrderId): Promise<ProviderStatus> {
      const link = await call(`/payment_links/${encodeURIComponent(providerOrderId)}`);
      const amount = Number(link.amount);
      const currency = String(link.currency);
      const payments = Array.isArray(link.payments) ? (link.payments as { payment_id?: string }[]) : [];
      const paymentId = payments.find((payment) => typeof payment.payment_id === 'string')?.payment_id;
      // Paid only if the full amount came in, whatever the label says.
      if (link.status === 'paid' && Number(link.amount_paid) >= amount) return { status: 'paid', amount, currency, paymentId };
      if (link.status === 'expired' || link.status === 'cancelled') return { status: 'expired', amount, currency };
      return { status: 'created', amount, currency };
    },
  };
};
