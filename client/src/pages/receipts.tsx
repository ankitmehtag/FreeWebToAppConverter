import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { formatPrice } from '../pay-panel';

type Receipt = { id: string; receiptNo: string; issuedAt: string; appName: string; amount: number; currency: string; couponCode: string | null; status: string };

/** The buyer's receipts. Plain receipts: the seller has no GST registration, so none is a tax invoice. */
export const Receipts = () => {
  const [receipts, setReceipts] = useState<Receipt[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api<Receipt[]>('/payments/receipts').then(setReceipts, () => setFailed(true));
  }, []);

  return (
    <main className="page">
      <h1>Receipts</h1>
      {failed && <p className="form-error" role="alert">Couldn’t load your receipts. Try again.</p>}
      {receipts?.length === 0 && <p>No receipts yet. <Link to="/my-apps">Back to your apps</Link></p>}
      {receipts?.map((receipt) => (
        <article key={receipt.id} className="build-panel">
          <h2>{receipt.receiptNo}</h2>
          <p>Premium for {receipt.appName}, {formatPrice(receipt.amount, receipt.currency)}{receipt.couponCode ? ` with code ${receipt.couponCode}` : ''}</p>
          <p className="field-hint">
            {new Date(receipt.issuedAt).toLocaleDateString()}{receipt.status === 'refunded' ? ', refunded' : ''}. This is a receipt, not a tax invoice.
          </p>
        </article>
      ))}
    </main>
  );
};
