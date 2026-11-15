import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { formatPrice } from '../pay-panel';
import { Failure, short, Table, useAct, useList, when, type Row } from './admin-kit';
import { Plans, Resellers } from './admin-resellers';
import { Prices } from './admin-prices';

const TABS = ['Overview', 'Users', 'Apps', 'Builds', 'Orders', 'Resellers', 'Plans', 'Prices', 'Audit'] as const;
type Tab = (typeof TABS)[number];

/** The owner's panel. The server answers 404 to anyone else, so a visitor sees nothing here. */
export const Admin = () => {
  const [state, setState] = useState<'loading' | 'hidden' | 'code' | 'open'>('loading');
  const [tab, setTab] = useState<Tab>('Overview');

  useEffect(() => {
    document.title = 'Admin';
    const meta = Object.assign(document.createElement('meta'), { name: 'robots', content: 'noindex, nofollow' });
    document.head.append(meta);
    api<{ enrolled: boolean; verified: boolean }>('/admin/api/2fa').then(
      (status) => setState(status.verified ? 'open' : 'code'),
      () => setState('hidden'),
    );
    return () => meta.remove();
  }, []);

  if (state === 'loading') return <main className="page"><p>Loading…</p></main>;
  if (state === 'hidden') return <main className="page"><h1>Page not found</h1></main>;
  if (state === 'code') return <CodeStep onDone={() => setState('open')} />;
  return (
    <main className="page">
      <h1>Admin</h1>
      <nav className="field-hint" aria-label="Admin sections">
        {TABS.map((name) => (
          <button key={name} type="button" className={`button button-small${name === tab ? '' : ' button-quiet'}`} onClick={() => setTab(name)} aria-current={name === tab}>{name}</button>
        ))}
      </nav>
      {tab === 'Overview' && <Overview />}
      {tab === 'Users' && <Users />}
      {tab === 'Apps' && <Apps />}
      {tab === 'Builds' && <Builds />}
      {tab === 'Orders' && <Orders />}
      {tab === 'Resellers' && <Resellers />}
      {tab === 'Plans' && <Plans />}
      {tab === 'Prices' && <Prices />}
      {tab === 'Audit' && <Audit />}
    </main>
  );
};

const CodeStep = ({ onDone }: { onDone: () => void }) => {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const submit = async () => {
    try {
      await api('/admin/api/2fa/verify', { method: 'POST', body: { code: code.trim() } });
      onDone();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Something went wrong');
    }
  };
  return (
    <main className="page">
      <h1>Admin sign-in</h1>
      <label className="field-label" htmlFor="admin-code">Code from your authenticator app</label>
      <input id="admin-code" className="field" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void submit()} />
      {error && <p className="form-error" role="alert">{error}</p>}
      <button type="button" className="button" disabled={code.trim().length !== 6} onClick={submit}>Continue</button>
    </main>
  );
};

type Overview = {
  users: { total: number; last24h: number };
  apps: { total: number; premium: number };
  builds: { last24h: number; last7d: number; successRate7d: number | null; medianSeconds7d: number | null; queued: number; running: number };
  revenue: { currency: string; total: number; orders: number }[];
};

const Overview = () => {
  const { data, error } = useList<Overview>('/admin/api/overview');
  if (!data) return <Failure message={error} />;
  const { builds } = data;
  const tiles: [string, string][] = [
    ['Users', `${data.users.total} (${data.users.last24h} new today)`],
    ['Apps', `${data.apps.total} (${data.apps.premium} Premium)`],
    ['Builds, 24 h / 7 d', `${builds.last24h} / ${builds.last7d}`],
    ['Success rate, 7 d', builds.successRate7d === null ? 'n/a' : `${builds.successRate7d}%`],
    ['Median build, 7 d', builds.medianSeconds7d === null ? 'n/a' : `${Math.round(builds.medianSeconds7d / 60 * 10) / 10} min`],
    ['Queue', `${builds.queued} waiting, ${builds.running} running`],
    ['Revenue', data.revenue.length ? data.revenue.map((row) => `${formatPrice(row.total, row.currency)} (${row.orders})`).join(', ') : 'none yet'],
  ];
  return <Table head={['What', 'Now']} rows={tiles} />;
};

const Users = () => {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const list = useList<Row[]>(`/admin/api/users?q=${encodeURIComponent(q)}`);
  const { act, message } = useAct(list.load);
  return (
    <section>
      <input className="field" placeholder="Search by email" value={q} onChange={(event) => setQ(event.target.value)} aria-label="Search users" />
      <Failure message={list.error} />
      {message}
      <Table head={['Email', 'Joined', 'State', '']} rows={(list.data ?? []).map((user) => [
        String(user.email),
        when(user.createdAt),
        user.disabledAt ? 'disabled' : user.emailVerifiedAt ? 'active' : 'unverified',
        <span key="a">
          <button type="button" className="button button-small button-quiet" onClick={() => setOpen(open === user.id ? null : user.id)}>Details</button>{' '}
          {user.disabledAt
            ? <button type="button" className="button button-small button-quiet" onClick={() => act('Enable user', `/users/${user.id}/enable`)}>Enable</button>
            : <button type="button" className="button button-small button-quiet" onClick={() => act('Disable user', `/users/${user.id}/disable`)}>Disable</button>}
        </span>,
      ])} />
      {open && <UserDetail id={open} />}
    </section>
  );
};

const UserDetail = ({ id }: { id: string }) => {
  const { data, error } = useList<{ apps: Row[]; builds: Row[]; orders: Row[] }>(`/admin/api/users/${id}`);
  if (!data) return <Failure message={error} />;
  return (
    <article className="build-panel">
      <h2>Apps</h2>
      <Table head={['App', 'Plan', 'Id']} rows={data.apps.map((app) => [String(app.name ?? ''), String(app.plan ?? 'free'), app.id])} />
      <h2>Builds</h2>
      <Table head={['Build', 'Status', 'Started']} rows={data.builds.map((build) => [short(build.id), String(build.status), when(build.createdAt)])} />
      <h2>Orders</h2>
      <Table head={['Order', 'Status', 'Amount']} rows={data.orders.map((order) => [order.id, String(order.status), formatPrice(Number(order.amount), String(order.currency))])} />
    </article>
  );
};

const Apps = () => {
  const [plan, setPlan] = useState('');
  const list = useList<Row[]>(`/admin/api/apps?plan=${plan}`);
  const { act, message } = useAct(list.load);
  return (
    <section>
      <select className="field" value={plan} onChange={(event) => setPlan(event.target.value)} aria-label="Plan">
        <option value="">All plans</option><option value="free">Free</option><option value="premium">Premium</option>
      </select>
      <Failure message={list.error} />
      {message}
      <Table head={['App', 'Plan', 'Builds', 'Id', '']} rows={(list.data ?? []).map((app) => [
        String(app.name ?? ''),
        String(app.plan ?? 'free'),
        String(app.buildCount ?? 0),
        app.id,
        <button key="a" type="button" className="button button-small button-quiet" onClick={() => act(`Make ${app.plan === 'premium' ? 'Free' : 'Premium'}`, `/apps/${app.id}/plan`, { plan: app.plan === 'premium' ? 'free' : 'premium' })}>
          Make {app.plan === 'premium' ? 'Free' : 'Premium'}
        </button>,
      ])} />
    </section>
  );
};

const Builds = () => {
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const list = useList<Row[]>(`/admin/api/builds?status=${status}`);
  const { act, message } = useAct(list.load);
  return (
    <section>
      <select className="field" value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Status">
        <option value="">All statuses</option>
        {['queued', 'building', 'signing', 'uploading', 'success', 'failed', 'canceled'].map((name) => <option key={name} value={name}>{name}</option>)}
      </select>
      <Failure message={list.error} />
      {message}
      <Table head={['Build', 'Status', 'Plan', 'Started', 'Error', '']} rows={(list.data ?? []).map((build) => [
        short(build.id), String(build.status), String(build.plan ?? ''), when(build.createdAt), String(build.error ?? ''),
        <span key="a">
          <button type="button" className="button button-small button-quiet" onClick={() => setOpen(open === build.id ? null : build.id)}>Log</button>{' '}
          {build.status === 'failed' && <button type="button" className="button button-small button-quiet" onClick={() => act('Retry build', `/builds/${build.id}/retry`)}>Retry</button>}
          {build.status === 'queued' && <button type="button" className="button button-small button-quiet" onClick={() => act('Cancel build', `/builds/${build.id}/cancel`)}>Cancel</button>}
        </span>,
      ])} />
      {open && <BuildLog id={open} />}
    </section>
  );
};

const BuildLog = ({ id }: { id: string }) => {
  const { data, error } = useList<{ log: { n: number; text: string }[] }>(`/admin/api/builds/${id}`);
  if (!data) return <Failure message={error} />;
  return <pre className="build-panel" style={{ overflowX: 'auto', maxHeight: 360 }}>{data.log.map((line) => line.text).join('\n') || 'No log saved for this build.'}</pre>;
};

const Orders = () => {
  const list = useList<Row[]>('/admin/api/orders');
  const { act, message } = useAct(list.load);
  const [code, setCode] = useState('');
  const [percent, setPercent] = useState('');
  return (
    <section>
      <Failure message={list.error} />
      {message}
      <Table head={['Order', 'Status', 'Amount', 'Date', '']} rows={(list.data ?? []).map((order) => [
        order.id, String(order.status), formatPrice(Number(order.amount), String(order.currency)), when(order.createdAt),
        order.status === 'paid' ? <button key="a" type="button" className="button button-small button-quiet" onClick={() => act('Refund order in full', `/orders/${order.id}/refund`)}>Refund</button> : '',
      ])} />
      <h2>New coupon</h2>
      <input className="field" placeholder="CODE" value={code} onChange={(event) => setCode(event.target.value)} aria-label="Coupon code" />
      <input className="field" placeholder="Percent off (1-100)" inputMode="numeric" value={percent} onChange={(event) => setPercent(event.target.value)} aria-label="Percent off" />
      <button type="button" className="button" disabled={!code.trim() || !/^\d{1,3}$/.test(percent)} onClick={() => act('Create coupon', '/coupons', { code: code.trim(), kind: 'percent', percent: Number(percent) })}>Create coupon</button>
    </section>
  );
};

const Audit = () => {
  const { data, error } = useList<(Row & { actor: string; action: string; reason: string; target: { kind: string; id: string } })[]>('/admin/api/audit');
  return (
    <section>
      <Failure message={error} />
      <Table head={['When', 'Who', 'Action', 'Target', 'Reason']} rows={(data ?? []).map((entry) => [when(entry.createdAt), entry.actor, entry.action, `${entry.target.kind} ${entry.target.id}`, entry.reason])} />
    </section>
  );
};
