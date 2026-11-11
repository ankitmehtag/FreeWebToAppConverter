import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api } from '../api';

type Order = { id: string; appId: string; status: string };

/** Where the payment page sends the buyer back. It trusts the server's record, not the address. */
export const PayReturn = () => {
  const [params] = useSearchParams();
  const orderId = params.get('order') ?? '';
  const [order, setOrder] = useState<Order | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await api<Order>(`/payments/orders/${encodeURIComponent(orderId)}`);
        setOrder(next);
        // The confirmation can arrive a few seconds after the buyer does.
        if ((next.status === 'created' || next.status === 'pending') && (tries += 1) < 20) timer = setTimeout(poll, 3000);
      } catch {
        setMissing(true);
      }
    };
    void poll();
    return () => clearTimeout(timer);
  }, [orderId]);

  if (missing) return <main className="page"><h1>We can’t find that payment</h1><p><Link to="/my-apps">Back to your apps</Link></p></main>;
  if (!order) return <main className="page"><p>Checking your payment…</p></main>;
  const back = <p><Link to={`/my-apps/${order.appId}/review`}>Back to your app</Link></p>;
  if (order.status === 'paid') return <main className="page"><h1>Premium is on</h1><p>Thank you. Your app is Premium now.</p>{back}</main>;
  if (order.status === 'failed' || order.status === 'refunded') return <main className="page"><h1>The payment didn’t go through</h1><p>You haven’t been charged for Premium. You can try again.</p>{back}</main>;
  return <main className="page"><h1>Waiting for your payment</h1><p>This can take a minute. This page updates by itself.</p>{back}</main>;
};
