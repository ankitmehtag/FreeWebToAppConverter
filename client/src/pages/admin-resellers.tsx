import { useState } from 'react';
import { formatPrice } from '../pay-panel';
import { Failure, Table, useAct, useList, when } from './admin-kit';

type Plan = { id: string; name: string; priceMinor: number; buildsPerMonth: number; api: boolean; builtWithLine: boolean; active: boolean };
type Reseller = {
  id: string; slug: string; brandName: string; logoUrl: string; accent: string; callbackUrl: string; userEmail: string | null; planId: string; planName: string | null;
  quota: { limit: number; used: number; bonus: number }; paidUntil: string | null; suspended: boolean; lapsed: boolean;
};
type Key = { id: string; name: string; prefix: string; createdAt: string; lastUsedAt: string | null; revoked: boolean };

const yes = (value: boolean) => (value ? 'yes' : 'no');
const quiet = 'button button-small button-quiet';

const Text = ({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) => (
  <input className="field" aria-label={label} placeholder={placeholder ?? label} value={value} onChange={(event) => onChange(event.target.value)} />
);
const Check = ({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) => (
  <label className="toggle"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span>{label}</span></label>
);

const emptyPlan = { name: '', price: '', builds: '', api: false, builtWith: true, active: true, applyNow: false };

/** The plans a reseller can be on. Prices are typed in rupees and stored in paise. */
export const Plans = () => {
  const list = useList<{ plans: Plan[] }>('/admin/api/plans');
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState(emptyPlan);
  const { act, message } = useAct(() => { list.load(); setEditing(null); setForm(emptyPlan); });
  const set = (patch: Partial<typeof emptyPlan>) => setForm({ ...form, ...patch });
  const valid = form.name.trim().length >= 2 && /^\d+(\.\d{1,2})?$/.test(form.price) && /^\d+$/.test(form.builds);
  const edit = (plan: Plan) => {
    setEditing(plan.id);
    setForm({ name: plan.name, price: String(plan.priceMinor / 100), builds: String(plan.buildsPerMonth), api: plan.api, builtWith: plan.builtWithLine, active: plan.active, applyNow: false });
  };
  const save = () => {
    const body = { name: form.name.trim(), priceMinor: Math.round(Number(form.price) * 100), buildsPerMonth: Number(form.builds), api: form.api, builtWithLine: form.builtWith, active: form.active };
    return editing ? act('Edit plan', `/plans/${editing}`, { ...body, ...(form.applyNow ? { applyQuotaNow: true } : {}) }) : act('Create plan', '/plans', body);
  };
  return (
    <section>
      <Failure message={list.error} />
      {message}
      <Table head={['Plan', 'Price a month', 'Builds a month', 'API', '"Built with" line', 'Offered', '']} rows={(list.data?.plans ?? []).map((plan) => [
        plan.name, formatPrice(plan.priceMinor, 'INR'), String(plan.buildsPerMonth), yes(plan.api), yes(plan.builtWithLine), yes(plan.active),
        <button key="e" type="button" className={quiet} onClick={() => edit(plan)}>Edit</button>,
      ])} />
      <h2>{editing ? 'Edit plan' : 'New plan'}</h2>
      <p className="field-hint">A new price or build count reaches new subscribers at once. Resellers already on the plan keep their price, and their builds change at the next renewal unless you apply it now.</p>
      <Text label="Plan name" value={form.name} onChange={(name) => set({ name })} />
      <Text label="Price a month (₹)" value={form.price} onChange={(price) => set({ price })} />
      <Text label="Builds a month" value={form.builds} onChange={(builds) => set({ builds })} />
      <Check label="API included" checked={form.api} onChange={(api) => set({ api })} />
      <Check label="Show the “Built with” line" checked={form.builtWith} onChange={(builtWith) => set({ builtWith })} />
      <Check label="Offered to new subscribers" checked={form.active} onChange={(active) => set({ active })} />
      {editing && <Check label="Apply the build count to current subscribers now" checked={form.applyNow} onChange={(applyNow) => set({ applyNow })} />}
      <button type="button" className="button" disabled={!valid} onClick={save}>{editing ? 'Save plan' : 'Create plan'}</button>
      {editing && <button type="button" className={quiet} onClick={() => { setEditing(null); setForm(emptyPlan); }}>Cancel</button>}
    </section>
  );
};

const emptyReseller = { email: '', slug: '', brandName: '', accent: '#2563eb', planId: '', logoUrl: '', callbackUrl: '', addQuota: '', resetQuota: false };

/** Resellers: create, change their brand, plan and quota, suspend, and revoke their API keys. */
export const Resellers = () => {
  const list = useList<{ resellers: Reseller[] }>('/admin/api/resellers');
  const plans = useList<{ plans: Plan[] }>('/admin/api/plans');
  const [editing, setEditing] = useState<Reseller | null>(null);
  const [keysOf, setKeysOf] = useState<string | null>(null);
  const [form, setForm] = useState(emptyReseller);
  const reset = () => { setEditing(null); setForm(emptyReseller); };
  const { act, message } = useAct(() => { list.load(); reset(); });
  const set = (patch: Partial<typeof emptyReseller>) => setForm({ ...form, ...patch });
  const planId = form.planId || plans.data?.plans.find((plan) => plan.active)?.id || '';
  const slugOk = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(form.slug.trim().toLowerCase());
  const accentOk = /^#[0-9a-fA-F]{6}$/.test(form.accent);

  const edit = (reseller: Reseller) => {
    setEditing(reseller);
    setForm({ email: '', slug: reseller.slug, brandName: reseller.brandName, accent: reseller.accent, planId: reseller.planId, logoUrl: reseller.logoUrl, callbackUrl: reseller.callbackUrl, addQuota: '', resetQuota: false });
  };
  // Only what changed is sent: sending the plan again would take a fresh copy of its current price.
  const save = () => {
    if (!editing) return act('Create reseller', '/resellers', { userEmail: form.email.trim(), slug: form.slug.trim().toLowerCase(), brandName: form.brandName.trim(), accent: form.accent, planId });
    const body: Record<string, unknown> = {};
    if (form.slug.trim().toLowerCase() !== editing.slug) body.slug = form.slug.trim().toLowerCase();
    if (form.brandName.trim() !== editing.brandName) body.brandName = form.brandName.trim();
    if (form.accent !== editing.accent) body.accent = form.accent;
    if (form.logoUrl.trim() !== editing.logoUrl) body.logoUrl = form.logoUrl.trim();
    if (form.callbackUrl.trim() !== editing.callbackUrl) body.callbackUrl = form.callbackUrl.trim();
    if (form.planId !== editing.planId) body.planId = form.planId;
    if (/^-?\d+$/.test(form.addQuota) && Number(form.addQuota) !== 0) body.addQuota = Number(form.addQuota);
    if (form.resetQuota) body.resetQuota = true;
    return Object.keys(body).length ? act('Edit reseller', `/resellers/${editing.id}`, body) : undefined;
  };
  const valid = editing ? slugOk && accentOk && form.brandName.trim().length >= 2 : slugOk && accentOk && form.brandName.trim().length >= 2 && /.+@.+\..+/.test(form.email) && Boolean(planId);

  return (
    <section>
      <Failure message={list.error} />
      {message}
      <Table head={['Brand', 'Owner', 'Plan', 'Builds used', 'Paid until', 'State', '']} rows={(list.data?.resellers ?? []).map((reseller) => [
        <span key="b">{reseller.brandName} <span className="mono">/r/{reseller.slug}</span></span>,
        reseller.userEmail ?? '',
        reseller.planName ?? '',
        `${reseller.quota.used} of ${reseller.quota.limit}`,
        reseller.paidUntil ? new Date(reseller.paidUntil).toLocaleDateString() : 'not paid by them',
        reseller.suspended ? 'suspended' : reseller.lapsed ? 'lapsed' : 'active',
        <span key="a">
          <button type="button" className={quiet} onClick={() => edit(reseller)}>Edit</button>{' '}
          {reseller.suspended
            ? <button type="button" className={quiet} onClick={() => act('Reactivate reseller', `/resellers/${reseller.id}/reactivate`)}>Reactivate</button>
            : <button type="button" className={quiet} onClick={() => act('Suspend reseller', `/resellers/${reseller.id}/suspend`)}>Suspend</button>}{' '}
          {reseller.lapsed
            ? <button type="button" className={quiet} onClick={() => act('Reinstate plan', `/resellers/${reseller.id}/reinstate-plan`)}>Reinstate plan</button>
            : <button type="button" className={quiet} onClick={() => act('Cancel plan', `/resellers/${reseller.id}/cancel-plan`)}>Cancel plan</button>}{' '}
          <button type="button" className={quiet} onClick={() => setKeysOf(keysOf === reseller.id ? null : reseller.id)}>Keys</button>
        </span>,
      ])} />
      {keysOf && <KeysOf id={keysOf} />}
      <h2>{editing ? `Edit ${editing.brandName}` : 'New reseller'}</h2>
      {!editing && <Text label="Owner's email (must already have an account)" value={form.email} onChange={(email) => set({ email })} />}
      <Text label="Page name (letters, numbers, dashes)" value={form.slug} onChange={(slug) => set({ slug })} />
      <Text label="Brand name" value={form.brandName} onChange={(brandName) => set({ brandName })} />
      <Text label="Accent colour (#rrggbb)" value={form.accent} onChange={(accent) => set({ accent })} />
      <select className="field" aria-label="Plan" value={editing ? form.planId : planId} onChange={(event) => set({ planId: event.target.value })}>
        {(plans.data?.plans ?? []).map((plan) => <option key={plan.id} value={plan.id}>{plan.name}{plan.active ? '' : ' (hidden)'}</option>)}
      </select>
      {editing && (
        <>
          <Text label="Logo address (https, optional)" value={form.logoUrl} onChange={(logoUrl) => set({ logoUrl })} />
          <Text label="Callback address (https, optional)" value={form.callbackUrl} onChange={(callbackUrl) => set({ callbackUrl })} />
          <Text label="Add builds this month (negative removes)" value={form.addQuota} onChange={(addQuota) => set({ addQuota })} placeholder="Add builds this month, e.g. 5" />
          <Check label="Start this month's count again from zero" checked={form.resetQuota} onChange={(resetQuota) => set({ resetQuota })} />
        </>
      )}
      <button type="button" className="button" disabled={!valid} onClick={save}>{editing ? 'Save reseller' : 'Create reseller'}</button>
      {editing && <button type="button" className={quiet} onClick={reset}>Cancel</button>}
    </section>
  );
};

const KeysOf = ({ id }: { id: string }) => {
  const list = useList<{ keys: Key[] }>(`/admin/api/resellers/${id}/keys`);
  const { act, message } = useAct(list.load);
  return (
    <article className="build-panel">
      <h2>API keys</h2>
      <Failure message={list.error} />
      {message}
      <Table head={['Name', 'Starts with', 'Made', 'Last used', '']} rows={(list.data?.keys ?? []).map((key) => [
        key.name, key.prefix, when(key.createdAt), key.lastUsedAt ? when(key.lastUsedAt) : 'never',
        key.revoked ? 'revoked' : <button key="r" type="button" className={quiet} onClick={() => act('Revoke key', `/resellers/${id}/keys/${key.id}/revoke`)}>Revoke</button>,
      ])} />
    </article>
  );
};
