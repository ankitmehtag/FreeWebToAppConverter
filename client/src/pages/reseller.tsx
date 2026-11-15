import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, ApiError } from '../api';
import { formatPrice, loadCheckoutScript } from '../pay-panel';
import { useSession } from '../session';
import type { AppView } from './apps';
import { statusLabel } from './build';

export type Brand = { slug: string; brandName: string; logoUrl: string | null; accent: string; showBuiltWith: boolean };

type Me = { brand: Brand; plan: { name: string | null }; quota: { limit: number; used: number; remaining: number }; apiEnabled: boolean; lapsed: boolean; payment: { available: boolean; priceMinor: number; paidUntil: string | null } };

/** Sets the accent for everything below it. The server only ever sends a plain `#rrggbb`. */
export const brandStyle = (accent: string) => ({ '--teal': accent, '--teal-deep': accent }) as CSSProperties;

export const BuiltWith = () => <p className="field-hint reseller-built">Built with Free Website to App Converter</p>;

const hostOf = (url?: string) => {
  try {
    return url ? new URL(url).host : '';
  } catch {
    return '';
  }
};

/** A reseller's own page: their brand, what is left of this month's builds, and their clients' apps. */
export const ResellerDashboard = () => {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const { signOut } = useSession();
  const [me, setMe] = useState<Me | 'hidden' | null>(null);
  const [apps, setApps] = useState<AppView[] | null>(null);
  const [error, setError] = useState('');
  const [paying, setPaying] = useState(false);
  const [notice, setNotice] = useState('');

  const loadMe = useCallback(
    () =>
      api<Me>('/resellers/me').then(
        (found) => {
          // Only the reseller who owns this slug sees the page; anyone else gets the same answer as for a page that does not exist.
          if (found.brand.slug !== slug.toLowerCase()) return setMe('hidden');
          document.title = `${found.brand.brandName} dashboard`;
          setMe(found);
        },
        () => setMe('hidden'),
      ),
    [slug],
  );

  useEffect(() => {
    document.title = 'Dashboard';
    const meta = Object.assign(document.createElement('meta'), { name: 'robots', content: 'noindex, nofollow' });
    document.head.append(meta);
    void loadMe();
    api<AppView[]>('/apps').then(setApps, () => setError('Couldn’t load the apps. Refresh to try again.'));
    return () => meta.remove();
  }, [loadMe]);

  /** Pays for the next month in Razorpay's own window. The server checks the signature before the month is added. */
  const pay = async (planName: string | null) => {
    if (paying) return;
    setPaying(true);
    setError('');
    setNotice('');
    try {
      const { checkout } = await api<{ id: string; checkout: { keyId: string | null; orderId: string; amount: number; currency: string; checkoutUrl: string | null } }>('/resellers/me/pay', { method: 'POST' });
      if (checkout.checkoutUrl) return void window.location.assign(checkout.checkoutUrl);
      await loadCheckoutScript();
      const modal = new window.Razorpay!({
        key: checkout.keyId,
        order_id: checkout.orderId,
        amount: checkout.amount,
        currency: checkout.currency,
        name: 'Free Website to App Converter',
        description: `${planName ?? 'Reseller'} plan, one month`,
        handler: (response: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => {
          const done = () => { setPaying(false); void loadMe(); };
          api('/resellers/me/pay/verify', { method: 'POST', body: response }).then(done, () => {
            // The webhook can still confirm it, so this is not an error.
            setNotice('We’re confirming your payment. It can take a minute: refresh this page soon.');
            done();
          });
        },
        modal: { ondismiss: () => { setPaying(false); setNotice('Payment cancelled. You haven’t been charged.'); } },
      });
      modal.on('payment.failed', (response) => setError(response.error?.description ?? 'The payment failed. You can try again.'));
      modal.open();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : failure instanceof Error ? failure.message : 'Couldn’t reach the server. Try again.');
      setPaying(false);
    }
  };

  const create = async () => {
    setError('');
    try {
      const app = await api<AppView>('/apps', { method: 'POST', body: {} });
      navigate(`/my-apps/${app.id}/basics`);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Couldn’t create the app. Try again.');
    }
  };

  if (me === null) return <main className="page"><p className="loading">Loading…</p></main>;
  if (me === 'hidden') return <main className="page"><h1>Page not found</h1></main>;

  const { brand, quota } = me;
  const share = quota.limit === 0 ? 0 : Math.min(100, Math.round((quota.used / quota.limit) * 100));
  return (
    <div className="reseller" style={brandStyle(brand.accent)}>
      <header className="topbar">
        <span className="reseller-brand">
          {brand.logoUrl && <img src={brand.logoUrl} alt="" className="reseller-logo" referrerPolicy="no-referrer" />}
          <span className="wordmark">{brand.brandName}</span>
        </span>
        <button type="button" className="button button-quiet button-small" onClick={async () => { await signOut(); navigate('/sign-in'); }}>Sign out</button>
      </header>
      <main className="page">
        <div className="page-head">
          <h1>Client apps</h1>
          <button type="button" className="button" onClick={create} disabled={me.lapsed}>New app</button>
        </div>
        <section className="reseller-quota" aria-label="Builds this month">
          <p>
            <strong>{quota.remaining}</strong> of {quota.limit} builds left this month{me.plan.name ? ` · ${me.plan.name} plan` : ''}
          </p>
          <div className="reseller-meter" role="progressbar" aria-valuemin={0} aria-valuemax={quota.limit} aria-valuenow={quota.used}>
            <span style={{ width: `${share}%` }} />
          </div>
          {me.payment.paidUntil && <p className="field-hint">Paid until {new Date(me.payment.paidUntil).toLocaleDateString()}</p>}
          {me.lapsed && <p className="form-error" role="alert">The plan has lapsed. Your apps and downloads keep working, but new builds are paused until it is renewed.</p>}
          {me.payment.available && (
            <button type="button" className="button" disabled={paying} onClick={() => pay(me.plan.name)}>
              {paying ? 'Opening payment…' : `Pay ${formatPrice(me.payment.priceMinor, 'INR')} for ${me.payment.paidUntil && !me.lapsed ? 'the next month' : 'a month'}`}
            </button>
          )}
          {notice && <p className="field-hint" role="status">{notice}</p>}
        </section>
        {error && <p className="form-error" role="alert">{error}</p>}
        {apps === null && !error && <p className="loading">Loading…</p>}
        {apps?.length === 0 && <div className="empty"><p>No client apps yet. Make the first one.</p></div>}
        {apps && apps.length > 0 && (
          <ul className="app-list">
            {apps.map((app) => (
              <li key={app.id}>
                <Link to={`/my-apps/${app.id}/basics`} className="app-row">
                  {app.hasIcon ? <img src={`/apps/${app.id}/icon?v=${encodeURIComponent(app.updatedAt)}`} alt="" className="app-row-icon" /> : <span className="app-row-icon app-row-icon-empty" aria-hidden="true" />}
                  <span className="app-row-text">
                    <span className="app-row-name">{app.draft.appName || 'Untitled app'}</span>
                    <span className="mono app-row-host">{hostOf(app.draft.startUrl) || 'No website yet'}</span>
                  </span>
                  <span className={`tag ${app.latestBuild?.status === 'success' && !app.latestBuild.expired ? 'tag-ready' : app.latestBuild?.status === 'failed' ? 'tag-failed' : ''}`}>
                    {app.latestBuild ? `v${app.latestBuild.versionName} · ${statusLabel(app.latestBuild)}` : app.ready ? 'Ready to build' : 'Draft'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {brand.showBuiltWith && <BuiltWith />}
      </main>
    </div>
  );
};
