import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_ICON_BYTES } from '@sitetoapk/shared/icon';
import { localS3, makeHarness, signedIn } from './auth-helpers';

type Harness = Awaited<ReturnType<typeof makeHarness>>;
type User = Awaited<ReturnType<typeof signedIn>>;
let h: Harness;
beforeAll(async () => { h = await makeHarness(); });
afterAll(() => h.close());
const email = () => `u${Math.random().toString(36).slice(2)}@example.com`;

const png = (width: number, height = width) =>
  sharp({ create: { width, height, channels: 4, background: { r: 20, g: 120, b: 200, alpha: 1 } } }).png().toBuffer();

const complete = {
  startUrl: 'https://example.com/',
  appName: 'Example',
  packageName: 'com.example.app',
  ui: { statusBarColor: '#0F172A' },
};

const newApp = async (user: User, draft: object = complete) => (await (await user.post('/apps', draft)).json()).id as string;

describe('AC12: uploaded icons', () => {
  it.each([
    ['a renamed JPEG', async () => sharp(await png(512)).jpeg().toBuffer(), 400, 'not a PNG'],
    ['a 256×256 PNG', () => png(256), 400, 'at least 512'],
    ['a non-square PNG', () => png(800, 600), 400, 'square'],
    ['a 6 MB file', async () => Buffer.concat([await png(512), randomBytes(MAX_ICON_BYTES + 1024 * 1024 - 50_000)]), 413, '5 MB'],
  ])('refuses %s with its reason', async (_name, make, status, reason) => {
    const user = await signedIn(h, email());
    const id = await newApp(user);
    const response = await user.upload(`/apps/${id}/icon`, await make());
    expect(response.status).toBe(status);
    expect((await response.json()).fields.icon).toContain(reason);
    expect((await (await user.get(`/apps/${id}`)).json()).hasIcon).toBe(false);
  });

  it('stores a valid icon re-encoded, and makes a complete app ready', async () => {
    const user = await signedIn(h, email());
    const id = await newApp(user);
    const original = Buffer.concat([await png(512), Buffer.from('trailing-payload')]);
    const response = await user.upload(`/apps/${id}/icon`, original, 'application/octet-stream');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ hasIcon: true, ready: true });

    const stored = await h.icons.get(`icons/${id}.png`);
    expect(stored?.includes('trailing-payload')).toBe(false);
    expect((await sharp(stored!).metadata()).width).toBe(512);
  });

  it('needs a CSRF token', async () => {
    const user = await signedIn(h, email());
    const id = await newApp(user);
    expect((await user.upload(`/apps/${id}/icon`, await png(512), 'image/png', { csrf: null })).status).toBe(403);
  });
});

describe('AC13: icons stay private', () => {
  it('serves the icon to its owner only, never cached', async () => {
    const owner = await signedIn(h, email());
    const stranger = await signedIn(h, email());
    const id = await newApp(owner);
    await owner.upload(`/apps/${id}/icon`, await png(512));

    const own = await owner.get(`/apps/${id}/icon`);
    expect(own.status).toBe(200);
    expect(own.headers.get('content-type')).toBe('image/png');
    expect(own.headers.get('cache-control')).toBe('private, no-store');

    expect((await stranger.get(`/apps/${id}/icon`)).status).toBe(404);
    expect((await h.client().get(`/apps/${id}/icon`)).status).toBe(401);
  });

  it('refuses the stored object to anyone without credentials', async () => {
    const owner = await signedIn(h, email());
    const id = await newApp(owner);
    await owner.upload(`/apps/${id}/icon`, await png(512));
    const direct = await fetch(`${localS3.endpoint}/${h.bucket}/icons/${id}.png`);
    expect(direct.status).toBe(403);
  });

  it('removes the icon when the app is deleted', async () => {
    const owner = await signedIn(h, email());
    const id = await newApp(owner);
    await owner.upload(`/apps/${id}/icon`, await png(512));
    expect((await owner.delete(`/apps/${id}`)).status).toBe(204);
    expect(await h.icons.get(`icons/${id}.png`)).toBeNull();
  });
});
