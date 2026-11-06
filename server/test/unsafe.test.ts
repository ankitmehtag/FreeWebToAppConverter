import { ObjectId } from 'mongodb';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { UnsafeCheckUnavailable, webRiskLookup, type UnsafeLookup } from '../src/abuse/unsafe';
import type { FetchUrl } from '../src/url/fetcher';
import { makeHarness, signedIn } from './auth-helpers';

// Google's own test pages, which every unsafe-site list reports.
const MALWARE = 'http://testsafebrowsing.appspot.com/s/malware.html';
const PHISHING = 'https://testsafebrowsing.appspot.com/s/phishing.html';
const listed = new Set([MALWARE, PHISHING, 'https://evil.test/']);

let lookups: string[] = [];
let down = false;
const fakeLookup: UnsafeLookup = async (url) => {
  lookups.push(url);
  if (down) throw new UnsafeCheckUnavailable('provider down');
  return listed.has(url) ? { unsafe: true, expireTime: new Date(Date.now() + 60_000).toISOString() } : { unsafe: false };
};

// Stands in for the safe fetcher: every site answers, and one redirects to a listed page.
const redirects: Record<string, string> = { 'https://redirects.test/': PHISHING };
const fakeFetch: FetchUrl = async (url) => ({
  url: redirects[url] ?? url,
  status: 200,
  headers: {},
  body: Buffer.from('<meta name="viewport" content="width=device-width">'),
});

type Harness = Awaited<ReturnType<typeof makeHarness>>;
let h: Harness;
let icon: Buffer;
beforeAll(async () => {
  h = await makeHarness({}, fakeFetch, {}, { unsafeLookup: fakeLookup });
  icon = await sharp({ create: { width: 512, height: 512, channels: 3, background: 'teal' } }).png().toBuffer();
});
afterAll(() => h.close());
beforeEach(async () => {
  lookups = [];
  down = false;
  // Each test starts with an empty cache.
  for (const key of await h.redis.keys('*unsafe:*')) await h.redis.del(key.replace(/^test:[^:]+:/, ''));
});

const email = () => `u${Math.random().toString(36).slice(2)}@example.com`;
const check = async (url: string) => (await h.client().post('/url/check', { url })).json();

const readyBuilder = async (draft: object) => {
  const address = email();
  const user = await signedIn(h, address);
  await h.users.updateOne({ email: address }, { $set: { emailVerifiedAt: new Date() } });
  const base = { startUrl: 'https://example.com/', appName: 'Example', packageName: `com.x${Math.random().toString(36).slice(2, 8)}.app`, ui: { statusBarColor: '#0F172A' } };
  const { id } = await (await user.post('/apps', base)).json();
  await user.upload(`/apps/${id}/icon`, icon);
  // Set straight in the database, as if the site was listed after the app was saved.
  await h.apps.updateOne({ _id: new ObjectId(id) }, { $set: Object.fromEntries(Object.entries(draft).map(([key, value]) => [`draft.${key}`, value])) });
  const start = async () => {
    const response = await user.post(`/apps/${id}/builds`, { idempotencyKey: crypto.randomUUID() });
    return { status: response.status, body: await response.json() };
  };
  return { user, id, start };
};

describe('F10 AC4: the URL check', () => {
  it('answers only `unsafe` for a listed site', async () => {
    expect(await check(MALWARE)).toEqual({ reachable: false, failure: 'unsafe' });
    expect(await check(PHISHING)).toEqual({ reachable: false, failure: 'unsafe' });
  });

  it('passes a clean site, and fails open while the provider is down', async () => {
    expect((await check('https://example.com/')).reachable).toBe(true);
    down = true;
    expect((await check('https://other.example/')).reachable).toBe(true);
  });
});

describe('F10 AC1: the wizard and build start', () => {
  it('refuses a listed site when the draft is saved', async () => {
    const user = await signedIn(h, email());
    const response = await user.post('/apps', { startUrl: PHISHING });
    expect(response.status).toBe(400);
    expect((await response.json()).fields.startUrl).toMatch(/unsafe sites/);
  });

  it('refuses a listed site at build start, without counting it', async () => {
    const { id, start } = await readyBuilder({ startUrl: PHISHING });
    expect(await start()).toMatchObject({ status: 409, body: { reason: 'unsafe_site' } });
    expect(await h.builds.countDocuments({ appId: new ObjectId(id) })).toBe(0);
  });

  it('refuses to build while the provider is down, without counting it', async () => {
    // A site nobody checked yet, so the answer can't come from the cache.
    const { id, start } = await readyBuilder({ startUrl: `https://fresh-${Date.now()}.example/` });
    down = true;
    expect(await start()).toMatchObject({ status: 503, body: { reason: 'safety_check_unavailable' } });
    expect(await h.builds.countDocuments({ appId: new ObjectId(id) })).toBe(0);
    down = false;
    expect((await start()).status).toBe(201);
  });
});

describe('F10 AC2: redirects and internal hosts', () => {
  it('refuses a clean start URL that redirects to a listed page', async () => {
    expect(await check('https://redirects.test/')).toEqual({ reachable: false, failure: 'unsafe' });
    const { start } = await readyBuilder({ startUrl: 'https://redirects.test/' });
    expect(await start()).toMatchObject({ status: 409, body: { reason: 'unsafe_site' } });
  });

  it('refuses a listed internal host, on save and at build start', async () => {
    const user = await signedIn(h, email());
    const { id } = await (await user.post('/apps', { startUrl: 'https://example.com/' })).json();
    const saved = await user.put(`/apps/${id}`, { startUrl: 'https://example.com/', internalHosts: ['example.com', 'evil.test'] });
    expect((await saved.json()).fields.internalHosts).toMatch(/unsafe sites/);

    const { start } = await readyBuilder({ internalHosts: ['example.com', 'evil.test'] });
    expect(await start()).toMatchObject({ status: 409, body: { reason: 'unsafe_site' } });
  });
});

describe('F10 AC3: cache', () => {
  it('asks the provider once for a URL checked twice', async () => {
    await check('https://cached.example/');
    await check('https://cached.example/');
    expect(lookups.filter((url) => url === 'https://cached.example/')).toHaveLength(1);
  });
});

describe('Web Risk lookup', () => {
  const answer = (status: number, body: object) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it('asks for the three threat types and reads a listing', async () => {
    let asked = '';
    const send = (async (url: string) => {
      asked = url;
      return new Response(JSON.stringify({ threat: { threatTypes: ['MALWARE'], expireTime: '2026-11-07T10:00:00Z' } }));
    }) as unknown as typeof fetch;
    expect(await webRiskLookup('KEY', send)(MALWARE)).toEqual({ unsafe: true, expireTime: '2026-11-07T10:00:00Z' });
    const params = new URL(asked).searchParams;
    expect(params.getAll('threatTypes')).toEqual(['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE']);
    expect(params.get('uri')).toBe(MALWARE);
  });

  it('reads an empty answer as clean, and an error as unavailable', async () => {
    expect(await webRiskLookup('KEY', answer(200, {}))('https://example.com/')).toEqual({ unsafe: false });
    await expect(webRiskLookup('KEY', answer(403, {}))('https://example.com/')).rejects.toBeInstanceOf(UnsafeCheckUnavailable);
  });
});
