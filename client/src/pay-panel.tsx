import { useEffect, useState } from 'react';
import { api, ApiError } from './api';

type Checkout = { provider: string; keyId: string | null; orderId: string; amount: number; currency: string; checkoutUrl: string | null };
type Order = { id: string; checkout: Checkout | null };

type RazorpayModal = { open: () => void; on: (event: 'payment.failed', handler: (response: { error?: { description?: string } }) => void) => void };
declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayModal;
  }
}

/** Razorpay's own script, loaded when the buyer clicks. The page never handles card details. */
export const loadCheckoutScript = () =>
  new Promise<void>((resolve, reject) => {
    if (window.Razorpay) return resolve();
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Couldn’t load the payment window. Check your connection and try again.'));
    document.head.appendChild(script);
  });

export type Prices = { premium: Record<string, number>; available: string[] };

/** Minor units to a price: ₹99, $1.50, £2. Whole amounts show no decimals. */
export const formatPrice = (amount: number, currency: string) =>
  new Intl.NumberFormat('en', { style: 'currency', currency, minimumFractionDigits: amount % 100 === 0 ? 0 : 2, useGrouping: false }).format(amount / 100);

const CHOICE_KEY = 'currency';

/** The server's price list and the buyer's pick, remembered in this browser when it still applies. */
export const usePrices = () => {
  const [prices, setPrices] = useState<Prices | null>(null);
  const [picked, setPicked] = useState('');
  useEffect(() => {
    api<Prices>('/payments/prices').then(setPrices, () => setPrices(null));
    try { setPicked(localStorage.getItem(CHOICE_KEY) ?? ''); } catch { /* private window: the default is fine */ }
  }, []);
  const currency = prices && (prices.available.includes(picked) ? picked : prices.available[0]);
  const choose = (next: string) => {
    setPicked(next);
    try { localStorage.setItem(CHOICE_KEY, next); } catch { /* not remembered, still works */ }
  };
  return { prices, currency, choose };
};

/** Shown only when more than one currency is on. */
export const CurrencyPicker = ({ prices, currency, onChange }: { prices: Prices; currency: string; onChange: (currency: string) => void }) =>
  prices.available.length > 1 ? (
    <label className="field">
      <span>Currency</span>
      <select value={currency} aria-label="Currency" onChange={(event) => onChange(event.target.value)}>
        {prices.available.map((code) => <option key={code} value={code}>{code}</option>)}
      </select>
    </label>
  ) : null;

/** Buy Premium for one app. Shown only when the server has a payment provider switched on. */
export const PayPanel = ({ appId }: { appId: string }) => {
  const { prices, currency, choose } = usePrices();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [code, setCode] = useState('');
  const [applied, setApplied] = useState<{ code: string; amount: number } | null>(null);

  if (!prices || !currency) return null;

  const apply = async () => {
    if (!code.trim() || busy) return;
    setError('');
    try {
      setApplied(await api<{ code: string; amount: number }>('/payments/coupon', { method: 'POST', body: { code, currency } }));
    } catch (failure) {
      setApplied(null);
      setError(failure instanceof ApiError ? failure.message : 'Couldn’t reach the server. Try again.');
    }
  };

  const buy = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const order = await api<Order>('/payments/checkout', { method: 'POST', body: { appId, currency, ...(applied ? { couponCode: applied.code } : {}) } });
      const { checkout } = order;
      // A free order has no payment step: it is already paid, and the return page shows it.
      if (!checkout) return void window.location.assign(`/pay/return?order=${order.id}`);
      if (checkout.checkoutUrl) return void window.location.assign(checkout.checkoutUrl);

      await loadCheckoutScript();
      const modal = new window.Razorpay!({
        key: checkout.keyId,
        order_id: checkout.orderId,
        amount: checkout.amount,
        currency: checkout.currency,
        name: 'Free Website to App Converter',
        description: 'Premium for one app',
        // Success: the server checks the signature before anything is marked paid.
        handler: (response: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => {
          api('/payments/verify', { method: 'POST', body: response }).then(
            () => window.location.assign(`/pay/return?order=${order.id}`),
            // The webhook may still confirm it, so the return page waits for the server's record.
            () => window.location.assign(`/pay/return?order=${order.id}`),
          );
        },
        modal: { ondismiss: () => { setBusy(false); setError('Payment cancelled. You haven’t been charged.'); } },
      });
      modal.on('payment.failed', (response) => setError(response.error?.description ?? 'The payment failed. You can try again.'));
      modal.open();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : failure instanceof Error ? failure.message : 'Couldn’t reach the server. Try again.');
      setBusy(false);
    }
  };

  return (
    <div className="build-panel">
      <h3>Premium</h3>
      <p className="field-hint">
        Your own signing key, an app bundle for Google Play, and no watermark. {formatPrice(prices.premium[currency] ?? 0, currency)} once, for this app.
      </p>
      <CurrencyPicker prices={prices} currency={currency} onChange={(next) => { choose(next); setApplied(null); }} />
      <label className="field">
        <span>Coupon code</span>
        <input type="text" value={code} maxLength={32} onChange={(event) => { setCode(event.target.value); setApplied(null); }} aria-label="Coupon code" />
      </label>
      <button type="button" className="button button-quiet" disabled={busy || !code.trim()} onClick={apply}>Apply code</button>
      {applied && <p className="hint" role="status">Code applied: {applied.amount === 0 ? 'free' : formatPrice(applied.amount, currency)}.</p>}
      <button type="button" className="button" disabled={busy} onClick={buy}>
        {busy ? 'Opening payment…' : applied ? (applied.amount === 0 ? 'Unlock Premium free' : `Buy Premium for ${formatPrice(applied.amount, currency)}`) : `Buy Premium for ${formatPrice(prices.premium[currency] ?? 0, currency)}`}
      </button>
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
};
