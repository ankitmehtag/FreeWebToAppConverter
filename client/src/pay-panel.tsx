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

  useEffect(() => {
    api<Prices>('/payments/prices').then(setPrices, () => setPrices(null));
  }, []);

  const currency = prices?.available[0];
  if (!prices || !currency) return null;

  const buy = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const order = await api<{ checkoutUrl: string }>('/payments/checkout', { method: 'POST', body: { appId, currency } });
      // The provider's own page takes the payment. Card details never reach this site.
      window.location.assign(order.checkoutUrl);
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
      <button type="button" className="button" disabled={busy} onClick={buy}>
        {busy ? 'Opening checkout…' : `Buy Premium for ${formatPrice(prices.premium[currency], currency)}`}
      </button>
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
};
