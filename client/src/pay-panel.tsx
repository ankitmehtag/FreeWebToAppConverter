import { useEffect, useState } from 'react';
import { api, ApiError } from './api';

type Prices = { premium: { INR: number; USD: number }; available: ('INR' | 'USD')[] };

export const formatPrice = (amount: number, currency: string) =>
  currency === 'INR' ? `₹${amount / 100}` : `$${amount / 100}`;

/** Buy Premium for one app. Shown only when the server has a payment provider switched on. */
export const PayPanel = ({ appId }: { appId: string }) => {
  const [prices, setPrices] = useState<Prices | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [code, setCode] = useState('');
  const [applied, setApplied] = useState<{ code: string; amount: number } | null>(null);

  useEffect(() => {
    api<Prices>('/payments/prices').then(setPrices, () => setPrices(null));
  }, []);

  const currency = prices?.available[0];
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
      const order = await api<{ id: string; checkoutUrl: string | null }>('/payments/checkout', { method: 'POST', body: { appId, currency, ...(applied ? { couponCode: applied.code } : {}) } });
      // The provider's own page takes the payment. Card details never reach this site.
      // A free order has no payment page: it is already paid, and the return page shows it.
      window.location.assign(order.checkoutUrl ?? `/pay/return?order=${order.id}`);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Couldn’t reach the server. Try again.');
      setBusy(false);
    }
  };

  return (
    <div className="build-panel">
      <h3>Premium</h3>
      <p className="field-hint">
        Your own signing key, an app bundle for Google Play, and no watermark. {formatPrice(prices.premium[currency], currency)} once, for this app.
      </p>
      <label className="field">
        <span>Coupon code</span>
        <input type="text" value={code} maxLength={32} onChange={(event) => { setCode(event.target.value); setApplied(null); }} aria-label="Coupon code" />
      </label>
      <button type="button" className="button button-quiet" disabled={busy || !code.trim()} onClick={apply}>Apply code</button>
      {applied && <p className="hint" role="status">Code applied: {applied.amount === 0 ? 'free' : formatPrice(applied.amount, currency)}.</p>}
      <button type="button" className="button" disabled={busy} onClick={buy}>
        {busy ? 'Opening checkout…' : applied ? (applied.amount === 0 ? 'Unlock Premium free' : `Buy Premium for ${formatPrice(applied.amount, currency)}`) : `Buy Premium for ${formatPrice(prices.premium[currency], currency)}`}
      </button>
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
};
