import type { PaymentProvider, ProviderStatus } from './provider';

const API = 'https://api.razorpay.com/v1';

type Options = { keyId: string; keySecret: string; fetchImpl?: typeof fetch };

/** Razorpay through hosted Payment Links, so the buyer pays on Razorpay's page and we never see a card. */
export const razorpay = ({ keyId, keySecret, fetchImpl = fetch }: Options): PaymentProvider => {
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
