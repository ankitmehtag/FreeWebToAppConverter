import { randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBuild, setStatus } from '@sitetoapk/shared/builds';
import { makeHarness, signedIn } from './auth-helpers';

type Harness = Awaited<ReturnType<typeof makeHarness>>;
let h: Harness;
beforeAll(async () => { h = await makeHarness(); });
afterAll(() => h.close());

const config = {
  schemaVersion: 1 as const,
  startUrl: 'https://example.com/',
  packageName: 'com.example.app',
  appName: 'Shady Shop',
  internalHosts: ['example.com'],
  ui: { statusBarColor: '#0F172A', orientation: 'unspecified' as const, zoom: false, progressBar: true, pullToRefresh: true, exitDialog: true },
};

/** A built app with an install link, as a reporter would reach it. */
const installToken = async (harness = h) => {
  const address = `u${Math.random().toString(36).slice(2)}@example.com`;
  const owner = await signedIn(harness, address);
  const me = await harness.users.findOne({ email: address });
  const id = randomUUID();
  const appId = new ObjectId();
  await createBuild(harness.builds, { _id: id, config, plan: 'free', versionCode: 1, versionName: '1.0', appId, ownerId: me!._id });
  await harness.icons.put(`free/${id}.apk`, Buffer.from('apk'));
  await setStatus(harness.builds, id, 'success', { artifactKey: `free/${id}.apk`, artifactBytes: 3, sha256: 'x', expiresAt: new Date(Date.now() + 60_000) });
  const { url } = await (await owner.post(`/builds/${id}/install-link`)).json();
  return { token: url.split('/').pop() as string, buildId: id, appId };
};

const report = (harness: Harness, body: object, ip = '203.0.113.5') =>
  harness.client().post('/reports', body, { headers: { 'x-forwarded-for': ip } });

describe('F10 AC7: reporting an app', () => {
  it('stores a report from a visitor with no account, and emails the operations address', async () => {
    const { token, buildId, appId } = await installToken();
    const response = await report(h, { token, reason: 'phishing', details: 'Asks for my bank PIN', email: 'Reporter@Example.com' });
    expect(response.status).toBe(202);

    const stored = await h.reports.findOne({ appId });
    expect(stored).toMatchObject({ buildId, reason: 'phishing', details: 'Asks for my bank PIN', email: 'reporter@example.com', status: 'open' });
    expect(JSON.stringify(stored)).not.toContain('203.0.113.5');

    const mail = await h.mailTo('abuse@example.com');
    expect(mail.subject).toBe('App report: phishing, Shady Shop');
    expect(mail.text).toContain('Asks for my bank PIN');
    expect(mail.text).toContain(String(appId));
  });

  it('refuses an unknown link, a made-up reason and extra fields', async () => {
    const { token } = await installToken();
    expect((await report(h, { token: 'x'.repeat(43), reason: 'phishing' })).status).toBe(404);
    expect((await report(h, { token, reason: 'boring' })).status).toBe(400);
    expect((await report(h, { token, reason: 'other', ownerId: 'x' })).status).toBe(400);
    expect((await report(h, { token, reason: 'other', details: 'x'.repeat(1001) })).status).toBe(400);
  });
});

describe('F10 AC8: report limits', () => {
  it('keeps one report per visitor per app, and updates it', async () => {
    const { token, appId } = await installToken();
    const before = h.sent.length;
    await report(h, { token, reason: 'other' }, '198.51.100.1');
    await report(h, { token, reason: 'malware', details: 'Second look' }, '198.51.100.1');
    const stored = await h.reports.find({ appId }).toArray();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ reason: 'malware', details: 'Second look' });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(h.sent.length - before).toBe(1);
  });

  it('answers 429 to the 11th report from one IP', async () => {
    const limited = await makeHarness({ routeLimit: 10 });
    const statuses: number[] = [];
    const { token } = await installToken(limited);
    for (let i = 0; i < 11; i += 1) statuses.push((await report(limited, { token, reason: 'other' })).status);
    expect(statuses.slice(0, 10).every((status) => status === 202)).toBe(true);
    expect(statuses[10]).toBe(429);
    await limited.close();
  });
});
