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

/** What the server needs from a payment provider. Card data never reaches us: checkout is the provider's hosted page. */
export interface PaymentProvider {
  readonly name: ProviderName;
  createCheckout(input: CheckoutInput): Promise<Checkout>;
  fetchStatus(providerOrderId: string): Promise<ProviderStatus>;
}
