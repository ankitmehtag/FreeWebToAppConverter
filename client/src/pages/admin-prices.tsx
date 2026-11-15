import { useState } from 'react';
import { formatPrice } from '../pay-panel';
import { Failure, useAct, useList } from './admin-kit';

type Row = { currency: string; amount: number | null; enabled: boolean };

const PriceRow = ({ row, save }: { row: Row; save: (currency: string, amount: number, enabled: boolean) => void }) => {
  const [price, setPrice] = useState(row.amount === null ? '' : String(row.amount / 100));
  const [enabled, setEnabled] = useState(row.enabled);
  const valid = /^\d+(\.\d{1,2})?$/.test(price) && Math.round(Number(price) * 100) >= 100;
  return (
    <tr>
      <td>{row.currency}</td>
      <td>{row.amount === null ? 'not set' : formatPrice(row.amount, row.currency)}</td>
      <td><input className="field" aria-label={`${row.currency} price`} value={price} onChange={(event) => setPrice(event.target.value)} /></td>
      <td><label className="toggle"><input type="checkbox" aria-label={`${row.currency} offered`} checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /><span>On</span></label></td>
      <td><button type="button" className="button button-small" disabled={!valid} onClick={() => save(row.currency, Math.round(Number(price) * 100), enabled)}>Save</button></td>
    </tr>
  );
};

/** Premium's price in each currency. Typed in whole units (49.99), stored in minor units. Open orders keep the price they started with. */
export const Prices = () => {
  const list = useList<{ prices: Row[] }>('/admin/api/prices');
  const { act, message } = useAct(() => list.load());
  const save = (currency: string, amount: number, enabled: boolean) => act(`Set ${currency} price`, '/prices', { currency, amount, enabled });
  return (
    <section>
      <Failure message={list.error} />
      {message}
      <p className="field-hint">Switch a currency on only after Razorpay has international payments enabled on your account. Payments in a currency Razorpay refuses fail with a short message and leave no open order.</p>
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead><tr>{['Currency', 'Now', 'New price', 'Offered', ''].map((name) => <th key={name} align="left">{name}</th>)}</tr></thead>
          <tbody>{(list.data?.prices ?? []).map((row) => <PriceRow key={`${row.currency}:${row.amount}:${row.enabled}`} row={row} save={save} />)}</tbody>
        </table>
      </div>
    </section>
  );
};
