import { createHmac, randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setStatus } from '@sitetoapk/shared/builds';
import { BACKOFF_MS, queueFinished, runCallbacks, sendDue, sign } from '../src/resellers/callbacks';
import { FetchFailure } from '../src/url/fetcher';
import { createPoster, type Post } from '../src/url/poster';
import { adminIn, makeHarness, signedIn } from './auth-helpers';

type Harness = Awaited<ReturnType<typeof makeHarness>>;
let h: Harness;
beforeAll(async () => { h = await makeHarness(); });
afterAll(() => h.close());
const why = { reason: 'testing callbacks' };
const tag = () => Math.random().toString(36).slice(2, 8);
const T0 = new Date('2026-11-16T10:00:00Z');

/** A reseller with a callback URL set through its own session, and one finished build. */
const withBuild = async (url = 'https://hooks.example.com/done', status = 'success') => {
  const admin = await adminIn(h);
  const address = `u${tag()}@example.com`;
  const user = await signedIn(h, address);
  const { id: planId } = await (await admin.user.post('/admin/api/plans', { name: `P ${tag()}`, priceMinor: 1, buildsPerMonth: 5, api: true, builtWithLine: true, ...why })).json();
  const { id } = await (await admin.user.post('/admin/api/resellers', { userEmail: address, slug: `s-${tag()}`, brandName: 'Agency', planId, ...why })).json();
  const set = await user.post('/resellers/me/callback', { url });
  expect(set.status).toBe(200);
  const { secret } = await set.json();
  const buildId = randomUUID();
  const reseller = await h.admin.resellers.resellers.findOne({ userId: (await h.users.findOne({ email: address }))!._id });
  await h.builds.insertOne({ _id: buildId as never, resellerId: reseller!._id, status: 'queued', history: ['queued'], plan: 'premium', versionCode: 1, versionName: '1.0', createdAt: T0, updatedAt: T0 } as never);
  await setStatus(h.builds, buildId, status as never);
  return { user, secret: secret as string, buildId, resellerId: reseller!._id };
};
const delivery = (buildId: string) => h.admin.resellers.callbacks.findOne({ buildId });
type Call = { url: string; body: string; headers: Record<string, string> };
const recorder = (answers: (number | Error)[]) => {
  const calls: Call[] = [];
  const post: Post = async (url, body, headers = {}) => {
    calls.push({ url, body, headers });
    const next = answers[Math.min(calls.length - 1, answers.length - 1)]!;
    if (next instanceof Error) throw next;
    return next;
  };
  return { calls, post };
};

describe('AC6: signed callbacks', () => {
  it('sends one signed POST that the receiver can verify', async () => {
    const { secret, buildId } = await withBuild();
    const { calls, post } = recorder([200]);
    await runCallbacks(h.admin.resellers, h.builds, post, T0);
    const mine = calls.filter((c) => JSON.parse(c.body).build.id === buildId);
    expect(mine).toHaveLength(1);
    const call = mine[0]!;
    expect(call.url).toBe('https://hooks.example.com/done');
    const [t, v1] = call.headers['x-signature']!.split(',').map((part) => part.split('=')[1]!);
    expect(Number(t)).toBe(Math.floor(T0.getTime() / 1000));
    expect(v1).toBe(createHmac('sha256', secret).update(`${t}.${call.body}`).digest('hex'));
    expect(call.headers['x-event']).toBe('build.succeeded');
    expect(JSON.parse(call.body)).toMatchObject({ event: 'build.succeeded', build: { id: buildId, status: 'success' } });
    expect((await delivery(buildId))!.status).toBe('delivered');
  });

  it('sends a failed build as build.failed, and only once however many sweeps run', async () => {
    const { buildId } = await withBuild('https://hooks.example.com/done', 'failed');
    const { calls, post } = recorder([204]);
    await Promise.all([runCallbacks(h.admin.resellers, h.builds, post, T0), runCallbacks(h.admin.resellers, h.builds, post, T0)]);
    await runCallbacks(h.admin.resellers, h.builds, post, new Date(T0.getTime() + 1000));
    const mine = calls.filter((c) => JSON.parse(c.body).build.id === buildId);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.headers['x-event']).toBe('build.failed');
  });

  it('retries a failing receiver with backoff, then gives up', async () => {
    const { buildId } = await withBuild();
    const { calls, post } = recorder([500]);
    let now = T0;
    await queueFinished(h.admin.resellers, h.builds, now);
    const count = () => calls.filter((c) => JSON.parse(c.body).build.id === buildId).length;
    await sendDue(h.admin.resellers, post, now);
    expect(count()).toBe(1);
    expect((await delivery(buildId))).toMatchObject({ status: 'pending', attempts: 1, reason: 'http_500' });
    await sendDue(h.admin.resellers, post, new Date(now.getTime() + 1000));
    expect(count()).toBe(1);
    for (const wait of BACKOFF_MS) {
      now = new Date(now.getTime() + wait + 1000);
      await sendDue(h.admin.resellers, post, now);
    }
    expect(count()).toBe(BACKOFF_MS.length + 1);
    expect(await delivery(buildId)).toMatchObject({ status: 'failed', attempts: BACKOFF_MS.length + 1 });
  });

  it('succeeds on a later try', async () => {
    const { buildId } = await withBuild();
    const { post } = recorder([503, new FetchFailure('unreachable'), 200]);
    let now = T0;
    await queueFinished(h.admin.resellers, h.builds, now);
    for (let i = 0; i < 3; i++) {
      await sendDue(h.admin.resellers, post, now);
      now = new Date(now.getTime() + 60 * 60_000);
    }
    expect(await delivery(buildId)).toMatchObject({ status: 'delivered', attempts: 3 });
  });

  it('does not queue anything for a reseller with no URL, or for old news once a URL is set', async () => {
    const { user, buildId } = await withBuild('');
    await queueFinished(h.admin.resellers, h.builds, T0);
    await user.post('/resellers/me/callback', { url: 'https://hooks.example.com/late' });
    await queueFinished(h.admin.resellers, h.builds, T0);
    expect(await delivery(buildId)).toBeNull();
  });

  it('refuses a private address at once and never retries it', async () => {
    const poster = createPoster();
    for (const url of ['https://127.0.0.1/hook', 'https://localhost/hook', 'https://169.254.169.254/latest', 'https://10.0.0.5/x', 'https://[::1]/x']) {
      await expect(poster(url, '{}')).rejects.toMatchObject({ code: expect.stringMatching(/blocked|unreachable/) });
    }
    await expect(poster('http://example.com/hook', '{}')).rejects.toMatchObject({ code: 'blocked' });
    const { buildId, resellerId } = await withBuild();
    await h.admin.resellers.resellers.updateOne({ _id: resellerId }, { $set: { callbackUrl: 'https://127.0.0.1/hook' } });
    await queueFinished(h.admin.resellers, h.builds, T0);
    await sendDue(h.admin.resellers, poster, T0);
    expect(await delivery(buildId)).toMatchObject({ status: 'failed', reason: 'blocked', attempts: 1 });
  });

  it('rejects a private IP, a non-https URL and a bad body when the reseller sets it', async () => {
    const { user } = await withBuild();
    expect((await user.post('/resellers/me/callback', { url: 'https://192.168.1.10/hook' })).status).toBe(400);
    expect((await user.post('/resellers/me/callback', { url: 'http://example.com/hook' })).status).toBe(400);
    expect((await user.post('/resellers/me/callback', { url: 'not a url' })).status).toBe(400);
  });

  it('rotates the secret, and signs with the new one', async () => {
    const { user, secret } = await withBuild();
    const rotated = (await (await user.post('/resellers/me/callback/rotate')).json()).secret as string;
    expect(rotated).not.toBe(secret);
    expect(rotated).toMatch(/^whsec_/);
    expect(sign(rotated, 'x', T0)).not.toBe(sign(secret, 'x', T0));
  });

  it('really posts the body and headers to a receiver', async () => {
    const seen: { body: string; signature?: string }[] = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => { seen.push({ body, signature: req.headers['x-signature'] as string }); res.writeHead(200).end('ok'); });
    }).listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    const port = (server.address() as AddressInfo).port;
    try {
      const poster = createPoster({ isAllowedAddress: () => true, ports: [port] });
      expect(await poster(`http://127.0.0.1:${port}/hook`, '{"a":1}', { 'x-signature': 'sig' })).toBe(200);
      expect(seen).toEqual([{ body: '{"a":1}', signature: 'sig' }]);
    } finally {
      server.close();
    }
  });
});
