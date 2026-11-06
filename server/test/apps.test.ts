import { ObjectId } from 'mongodb';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appConfigSchema, toAppConfig } from '@sitetoapk/shared';
import { MAX_APPS_PER_USER } from '../src/apps';
import { makeHarness, signedIn } from './auth-helpers';

type Harness = Awaited<ReturnType<typeof makeHarness>>;
type User = Awaited<ReturnType<typeof signedIn>>;
let h: Harness;
beforeAll(async () => { h = await makeHarness(); });
afterAll(() => h.close());
const email = () => `u${Math.random().toString(36).slice(2)}@example.com`;

const complete = {
  startUrl: 'https://example.com/',
  appName: 'Example',
  packageName: 'com.example.app',
  ui: { statusBarColor: '#0F172A' },
};

const create = async (user: User, draft: object = {}) => {
  const response = await user.post('/apps', draft);
  return { status: response.status, body: await response.json() };
};

/** Stands in for F09 until builds exist: a successful build locks the package name. */
const recordBuild = (id: string) =>
  h.apps.updateOne({ _id: new ObjectId(id) }, { $set: { lockedAt: new Date() }, $inc: { buildCount: 1 } });

describe('AC3: apps belong to their owner', () => {
  it('answers 404 to another user and changes nothing', async () => {
    const owner = await signedIn(h, email());
    const stranger = await signedIn(h, email());
    const { body: app } = await create(owner, { startUrl: 'https://example.com/', appName: 'Mine' });

    expect((await stranger.get(`/apps/${app.id}`)).status).toBe(404);
    expect((await stranger.put(`/apps/${app.id}`, { appName: 'Stolen' })).status).toBe(404);
    expect((await stranger.delete(`/apps/${app.id}`)).status).toBe(404);
    expect(await (await stranger.get('/apps')).json()).toEqual([]);

    const after = await (await owner.get(`/apps/${app.id}`)).json();
    expect(after.draft.appName).toBe('Mine');
  });

  it('answers a missing app and a malformed id the same way', async () => {
    const user = await signedIn(h, email());
    expect((await user.get(`/apps/${new ObjectId()}`)).status).toBe(404);
    expect((await user.get('/apps/not-an-id')).status).toBe(404);
  });

  it('lists only the caller’s apps', async () => {
    const one = await signedIn(h, email());
    const two = await signedIn(h, email());
    await create(one, { appName: 'One' });
    await create(two, { appName: 'Two' });
    const list = await (await one.get('/apps')).json();
    expect(list.map((app: { draft: { appName: string } }) => app.draft.appName)).toEqual(['One']);
  });

  it('needs a session and a CSRF token', async () => {
    expect((await h.client().get('/apps')).status).toBe(401);
    const user = await signedIn(h, email());
    expect((await user.post('/apps', {}, { csrf: null })).status).toBe(403);
    const { body: app } = await create(user);
    expect((await user.put(`/apps/${app.id}`, {}, { csrf: 'wrong' })).status).toBe(403);
    expect((await user.delete(`/apps/${app.id}`, { csrf: null })).status).toBe(403);
  });
});

describe('AC4: drafts and ready apps', () => {
  it('saves a draft with only a URL, unchanged and not ready', async () => {
    const user = await signedIn(h, email());
    const { status, body: app } = await create(user, { startUrl: 'https://example.com/' });
    expect(status).toBe(201);
    const reloaded = await (await user.get(`/apps/${app.id}`)).json();
    expect(reloaded.draft).toEqual({ startUrl: 'https://example.com/' });
    expect(reloaded.ready).toBe(false);
  });

  it('is ready with every field and an icon, and renders a valid config', async () => {
    const user = await signedIn(h, email());
    const { body: app } = await create(user);
    const withoutIcon = await (await user.put(`/apps/${app.id}`, complete)).json();
    expect(withoutIcon.ready).toBe(false);

    const icon = await sharp({ create: { width: 512, height: 512, channels: 3, background: 'navy' } }).png().toBuffer();
    expect((await (await user.upload(`/apps/${app.id}/icon`, icon)).json()).ready).toBe(true);
    const saved = await (await user.put(`/apps/${app.id}`, complete)).json();
    expect(saved.ready).toBe(true);
    expect(appConfigSchema.safeParse(toAppConfig(saved.draft)).success).toBe(true);
  });
});

describe('AC5: deleting', () => {
  it('deletes an app that was never built', async () => {
    const user = await signedIn(h, email());
    const { body: app } = await create(user);
    expect((await user.delete(`/apps/${app.id}`)).status).toBe(204);
    expect((await user.get(`/apps/${app.id}`)).status).toBe(404);
  });

  it('refuses to delete an app with a recorded build', async () => {
    const user = await signedIn(h, email());
    const { body: app } = await create(user, complete);
    await recordBuild(app.id);
    expect((await user.delete(`/apps/${app.id}`)).status).toBe(409);
    expect((await user.get(`/apps/${app.id}`)).status).toBe(200);
  });
});

describe('AC6: package names', () => {
  it('refuses a second app of one user with the same package name', async () => {
    const user = await signedIn(h, email());
    await create(user, { packageName: 'com.shared.app' });
    const second = await create(user, { packageName: 'com.shared.app' });
    expect(second.status).toBe(409);
    expect(second.body.fields.packageName).toBeTruthy();

    const { body: other } = await create(user, { packageName: 'com.other.app' });
    expect((await user.put(`/apps/${other.id}`, { packageName: 'com.shared.app' })).status).toBe(409);
  });

  it('lets two users use the same package name', async () => {
    expect((await create(await signedIn(h, email()), { packageName: 'com.same.app' })).status).toBe(201);
    expect((await create(await signedIn(h, email()), { packageName: 'com.same.app' })).status).toBe(201);
  });

  it('locks the package name after a successful build, and still saves other fields', async () => {
    const user = await signedIn(h, email());
    const { body: app } = await create(user, complete);
    await recordBuild(app.id);

    const renamed = await user.put(`/apps/${app.id}`, { ...complete, packageName: 'com.renamed.app' });
    expect(renamed.status).toBe(409);
    expect((await renamed.json()).fields.packageName).toMatch(/first build/);
    expect((await user.put(`/apps/${app.id}`, { ...complete, packageName: undefined })).status).toBe(409);

    const edited = await user.put(`/apps/${app.id}`, { ...complete, appName: 'New name' });
    expect(edited.status).toBe(200);
    const body = await edited.json();
    expect(body.draft).toMatchObject({ appName: 'New name', packageName: 'com.example.app' });
    expect(body.locked).toBe(true);
  });
});

describe('AC7: app limit', () => {
  it(`refuses app number ${MAX_APPS_PER_USER + 1}`, async () => {
    const user = await signedIn(h, email());
    for (let i = 0; i < MAX_APPS_PER_USER; i += 1) expect((await create(user)).status).toBe(201);
    expect((await create(user)).status).toBe(409);
  });
});

describe('AC9: server-side field checks', () => {
  it.each([
    ['appName', { appName: 'Bad\u0000name' }],
    ['packageName', { packageName: 'not a package' }],
    ['packageName', { packageName: 'com.void.app' }],
    ['ui.statusBarColor', { ui: { statusBarColor: 'javascript:alert(1)' } }],
    ['startUrl', { startUrl: 'http://example.com/' }],
    ['_', { plan: 'premium' }],
  ])('refuses a bad %s with a field error', async (field, draft) => {
    const user = await signedIn(h, email());
    const { status, body } = await create(user, draft);
    expect(status).toBe(400);
    expect(Object.keys(body.fields)).toEqual([field]);
  });

  it('refuses the same values on update', async () => {
    const user = await signedIn(h, email());
    const { body: app } = await create(user);
    const response = await user.put(`/apps/${app.id}`, { appName: 'x', packageName: 'com.class.app' });
    expect(response.status).toBe(400);
    expect((await response.json()).fields.packageName).toBeTruthy();
  });

  it('stores a hostile app name as plain text', async () => {
    const user = await signedIn(h, email());
    const name = '"; rm -rf / <script>x</script>';
    const { body: app } = await create(user, { appName: name });
    expect((await (await user.get(`/apps/${app.id}`)).json()).draft.appName).toBe(name);
  });
});

describe('any website can become an app', () => {
  it('saves a well-known site with its own name and suggested package name', async () => {
    // The owner removed the brand denylist on 2026-11-07, so anyone may wrap any site.
    const user = await signedIn(h, email());
    const draft = { startUrl: 'https://www.google.com/', appName: 'Google', packageName: 'com.google.app', internalHosts: ['google.com'] };
    const { status, body } = await create(user, draft);
    expect(status).toBe(201);
    expect(body.draft).toMatchObject(draft);
  });
});
