import { randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { setStatus } from '@sitetoapk/shared/builds';
import { createNotify } from '../src/resellers/notices';
import { renewQuota } from '../src/resellers/quota';
import { adminIn, makeHarness, signedIn } from './auth-helpers';

type Harness = Awaited<ReturnType<typeof makeHarness>>;
type User = Awaited<ReturnType<typeof signedIn>>;
let h: Harness;
let icon: Buffer;
beforeAll(async () => {
  h = await makeHarness();
  icon = await sharp({ create: { width: 512, height: 512, channels: 3, background: 'teal' } }).png().toBuffer();
});
afterAll(() => h.close());
const why = { reason: 'testing notices' };
const tag = () => Math.random().toString(36).slice(2, 8);

const setup = async (builds: number, brandName = 'Pixel Agency') => {
  const admin = await adminIn(h);
  const address = `u${tag()}@example.com`;
  const user = await signedIn(h, address);
  await h.users.updateOne({ email: address }, { $set: { emailVerifiedAt: new Date() } });
  const { id: planId } = await (await admin.user.post('/admin/api/plans', { name: `Plan ${tag()}`, priceMinor: 249900, buildsPerMonth: builds, api: false, builtWithLine: true, ...why })).json();
  const slug = `s-${tag()}`;
  const { id } = await (await admin.user.post('/admin/api/resellers', { userEmail: address, slug, brandName, planId, ...why })).json();
  return { user, address, slug, resellerId: new ObjectId(id as string) };
};
const buildOnce = async (user: User) => {
  const { id } = await (await user.post('/apps', { startUrl: 'https://example.com/', appName: 'Example', packageName: `com.app${tag()}.app`, ui: { statusBarColor: '#0F172A' } })).json();
  await user.upload(`/apps/${id}/icon`, icon);
  const response = await user.post(`/apps/${id}/builds`, { idempotencyKey: randomUUID() });
  expect(response.status).toBe(201);
  await setStatus(h.builds, (await response.json()).id, 'success');
};
const mailsTo = (address: string, subject: RegExp) => h.sent.filter((mail) => mail.to === address && subject.test(mail.subject));
const resellerDoc = async (id: ObjectId) => (await h.admin.resellers.resellers.findOne({ _id: id }))!;

describe('AC9: reseller emails go out once per event', () => {
  it('warns once a month when four-fifths of the builds are used, and again after a renewal', async () => {
    const { user, address, slug, resellerId } = await setup(5);
    for (let i = 0; i < 3; i++) await buildOnce(user);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(mailsTo(address, /builds/)).toHaveLength(0);
    await buildOnce(user);
    await vi.waitFor(() => expect(mailsTo(address, /used 4 of 5 builds/)).toHaveLength(1));
    const mail = mailsTo(address, /used 4 of 5 builds/)[0]!;
    expect(mail.text).toContain(`/r/${slug}`);
    expect(mail.html).toContain(`/r/${slug}`);
    await buildOnce(user);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(mailsTo(address, /builds/)).toHaveLength(1);
    await renewQuota(h.admin.resellers, resellerId);
    for (let i = 0; i < 4; i++) await buildOnce(user);
    await vi.waitFor(() => expect(mailsTo(address, /used 4 of 5 builds/)).toHaveLength(2));
  });

  it('sends started, payment failed and cancelled emails once for the same event, and again for a new one', async () => {
    const { address, resellerId } = await setup(30, 'Pixel <b>Agency</b>');
    const notify = h.admin.resellers.notify!;
    const reseller = await resellerDoc(resellerId);
    expect(await notify('subscription_started', reseller, `started:${tag()}:1`)).toBe(true);
    const key = `failed:${resellerId}:evt1`;
    expect(await notify('payment_failed', reseller, key)).toBe(true);
    expect(await notify('payment_failed', reseller, key)).toBe(false);
    expect(await notify('payment_failed', reseller, `failed:${resellerId}:evt2`)).toBe(true);
    expect(await notify('subscription_cancelled', reseller, `cancelled:${resellerId}:1`)).toBe(true);
    const started = mailsTo(address, /is on the/)[0]!;
    expect(started.text).toMatch(/30 builds a month for ₹2499 a month/);
    expect(started.html).toContain('Pixel &lt;b&gt;Agency&lt;/b&gt;');
    expect(started.html).not.toContain('<b>Agency');
    expect(mailsTo(address, /needs renewing/)).toHaveLength(2);
    expect(mailsTo(address, /was cancelled/)).toHaveLength(1);
    expect(mailsTo(address, /was cancelled/)[0]!.text).toMatch(/downloads keep working/);
  });

  it('never breaks the action, logs no address, and lets the next event try again', async () => {
    const { address, resellerId } = await setup(5);
    const reseller = await resellerDoc(resellerId);
    const sent: string[] = [];
    let down = true;
    const mailer = { send: async (mail: { to: string }) => { if (down) throw new Error(`refused ${mail.to}`); sent.push(mail.to); } };
    const notify = createNotify({ notices: h.db.collection('resellerNotices'), plans: h.admin.resellers.plans, users: h.users, mailer, appUrl: 'https://example.com' });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const key = `failed:${resellerId}:down`;
    await expect(notify('payment_failed', reseller, key)).resolves.toBe(false);
    expect(JSON.stringify(logged.mock.calls)).not.toContain(address);
    expect(JSON.stringify(logged.mock.calls)).toContain('[address]');
    logged.mockRestore();
    down = false;
    await expect(notify('payment_failed', reseller, key)).resolves.toBe(true);
    expect(sent).toEqual([address]);
  });

  it('does not email anyone for an ordinary user\'s builds', async () => {
    const address = `u${tag()}@example.com`;
    const user = await signedIn(h, address);
    await h.users.updateOne({ email: address }, { $set: { emailVerifiedAt: new Date() } });
    const before = h.sent.length;
    await buildOnce(user);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(h.sent.slice(before).filter((mail) => mail.to === address && /builds/.test(mail.subject))).toHaveLength(0);
  });
});
