import type { Currency } from './prices';

export type ProviderName = 'razorpay' | 'stripe';

export type CheckoutInput = {
  orderId: string;
  /** Minor units. */
  amount: number;
  currency: Currency;
  description: string;
  customerEmail: string;
  /** Where the provider sends the buyer afterwards. The page reads the real status from the server. */
  returnUrl: string;
};

export type Checkout = { providerOrderId: string; checkoutUrl: string };

/** What the provider says about an order right now. `created` covers unpaid and part-paid. */
export type ProviderStatus = {
  status: 'created' | 'paid' | 'failed' | 'expired';
  amount: number;
  currency: string;
  paymentId?: string;
};

/** A signed message from a provider, reduced to what the server acts on. */
export type WebhookEvent = {
  /** The provider's own id for this delivery, so a repeat can be spotted. */
  eventId: string;
  type: 'paid' | 'refunded' | 'failed' | 'disputed' | 'ignored';
  providerOrderId?: string;
  paymentId?: string;
  amount?: number;
  currency?: string;
};

/** What the server needs from a payment provider. Card data never reaches us: checkout is the provider's hosted page. */
export interface PaymentProvider {
  readonly name: ProviderName;
  createCheckout(input: CheckoutInput): Promise<Checkout>;
  fetchStatus(providerOrderId: string): Promise<ProviderStatus>;
  /** A full refund of one payment. */
  refund(paymentId: string, amount: number): Promise<{ refundId: string }>;
  /** Checks the signature on the raw body first. Null means it is not from the provider, so nothing may be read from it. */
  verifyWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): WebhookEvent | null;
}
