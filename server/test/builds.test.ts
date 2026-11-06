import { randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setStatus } from '@sitetoapk/shared/builds';
import { makeHarness, signedIn } from './auth-helpers';

type Harness = Awaited<ReturnType<typeof makeHarness>>;
type User = Awaited<ReturnType<typeof signedIn>>;
let h: Harness;
let icon: Buffer;
beforeAll(async () => {
  h = await makeHarness();
  icon = await sharp({ create: { width: 512, height: 512, channels: 3, background: 'teal' } }).png().toBuffer();
});
afterAll(() => h.close());

const email = () => `u${Math.random().toString(36).slice(2)}@example.com`;
const key = () => randomUUID();

const verifiedUser = async (harness = h) => {
  const address = email();
  const user = await signedIn(harness, address);
  await harness.users.updateOne({ email: address }, { $set: { emailVerifiedAt: new Date() } });
  return user;
};

const readyApp = async (user: User, packageName = `com.app${Math.random().toString(36).slice(2, 8)}.app`) => {
  const draft = { startUrl: 'https://example.com/', appName: 'Example', packageName, ui: { statusBarColor: '#0F172A' } };
  const { id } = await (await user.post('/apps', draft)).json();
  await user.upload(`/apps/${id}/icon`, icon);
  return id as string;
};

const start = async (user: User, appId: string, body: object = { idempotencyKey: key() }) => {
  const response = await user.post(`/apps/${appId}/builds`, body);
  return { status: response.status, body: await response.json() };
};

/** Ends a build the way the worker would, freeing the app for the next one. */
const finish = (buildId: string, fields: object = {}) => setStatus(h.builds, buildId, 'success', fields);

describe('F09 AC1: who can build what', () => {
  it('refuses another user’s app, an unfinished app and an unverified owner, queuing nothing', async () => {
    const owner = await verifiedUser();
    const appId = await readyApp(owner);
    const stranger = await verifiedUser();
    const before = h.jobs.length;

    expect((await start(stranger, appId)).status).toBe(404);

    const { id: draftId } = await (await owner.post('/apps', { startUrl: 'https://example.com/' })).json();
    const unfinished = await start(owner, draftId);
    expect(unfinished).toMatchObject({ status: 409, body: { reason: 'not_ready' } });

    const unverified = await signedIn(h, email());
    const theirApp = await readyApp(unverified);
    expect(await start(unverified, theirApp)).toMatchObject({ status: 403, body: { reason: 'email_unverified' } });

    expect(h.jobs.length).toBe(before);
    expect(await h.builds.countDocuments({ appId: { $in: [new ObjectId(appId), new ObjectId(theirApp)] } })).toBe(0);
  });

  it('queues a build for a verified owner of a ready app', async () => {
    const user = await verifiedUser();
    const appId = await readyApp(user);
    const { status, body } = await start(user, appId);
    expect(status).toBe(201);
    expect(body).toMatchObject({ status: 'queued', versionCode: 1, versionName: '1.0' });
    expect(h.jobs.at(-1)?.data.buildId).toBe(body.id);
    expect(await h.icons.get(`builds/${body.id}/icon.png`)).not.toBeNull();
  });
});

describe('F09 AC2: one build at a time', () => {
  it('makes one build from a double click and from 10 parallel starts with one key', async () => {
    const user = await verifiedUser();
    const appId = await readyApp(user);
    const idempotencyKey = key();
    const results = await Promise.all(Array.from({ length: 10 }, () => start(user, appId, { idempotencyKey })));
    expect(new Set(results.map((result) => result.body.id)).size).toBe(1);
    expect(results.filter((result) => result.status === 201)).toHaveLength(1);
    expect(await h.builds.countDocuments({ appId: new ObjectId(appId) })).toBe(1);
  });

  it('refuses a second build while one is running, and allows it once that one ends', async () => {
    const user = await verifiedUser();
    const appId = await readyApp(user);
    const first = await start(user, appId);
    expect(await start(user, appId)).toMatchObject({ status: 409, body: { reason: 'build_running', buildId: first.body.id } });
    await finish(first.body.id);
    expect((await start(user, appId)).status).toBe(201);
  });
});

describe('F09 AC3: version codes', () => {
  it('never gives two builds of an app the same code, with no gaps', async () => {
    const user = await verifiedUser();
    const appId = await readyApp(user);
    const codes: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const { body } = await start(user, appId);
      codes.push(body.versionCode);
      await finish(body.id);
      await h.builds.updateOne({ _id: body.id }, { $set: { countsTowardLimit: false } });
    }
    expect(codes).toEqual([1, 2, 3]);
  });

  it('keeps the increment unique under 20 parallel calls', async () => {
    const appId = new ObjectId();
    await h.apps.insertOne({ _id: appId, ownerId: new ObjectId(), draft: {}, buildCount: 0 });
    const codes = await Promise.all(
      Array.from({ length: 20 }, async () =>
        (await h.apps.findOneAndUpdate({ _id: appId }, { $inc: { versionCode: 1 } }, { returnDocument: 'after' }))!.versionCode,
      ),
    );
    expect([...codes].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it('keeps the version name the user chose, and repeats it by default', async () => {
    const user = await verifiedUser();
    const appId = await readyApp(user);
    const first = await start(user, appId, { idempotencyKey: key(), versionName: '2.1' });
    expect(first.body.versionName).toBe('2.1');
    await finish(first.body.id);
    expect((await start(user, appId)).body.versionName).toBe('2.1');
  });

  it('adds to the app’s build count', async () => {
    const user = await verifiedUser();
    const appId = await readyApp(user);
    await start(user, appId);
    expect((await h.apps.findOne({ _id: new ObjectId(appId) }))?.buildCount).toBe(1);
  });
});

describe('F09 AC4: daily limit', () => {
  it('refuses the 4th build in 24 hours and says when the next is allowed', async () => {
    const user = await verifiedUser();
    const apps = [await readyApp(user), await readyApp(user), await readyApp(user), await readyApp(user)];
    const first = await start(user, apps[0]!);
    await start(user, apps[1]!);
    await start(user, apps[2]!);
    const fourth = await start(user, apps[3]!);
    expect(fourth).toMatchObject({ status: 429, body: { reason: 'daily_limit' } });
    const created = new Date((await h.builds.findOne({ _id: first.body.id }))!.createdAt);
    expect(new Date(fourth.body.nextAllowedAt).getTime()).toBe(created.getTime() + 24 * 60 * 60 * 1000);
  });

  it('doesn’t count a build our infrastructure failed, or one older than 24 hours', async () => {
    const user = await verifiedUser();
    const apps = [await readyApp(user), await readyApp(user), await readyApp(user), await readyApp(user)];
    const ours = await start(user, apps[0]!);
    await setStatus(h.builds, ours.body.id, 'failed', { failureKind: 'infra', countsTowardLimit: false });
    const old = await start(user, apps[1]!);
    await h.builds.updateOne({ _id: old.body.id }, { $set: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) } });
    await start(user, apps[2]!);
    expect((await start(user, apps[3]!)).status).toBe(201);
  });

  it('can’t be passed by parallel starts on different apps', async () => {
    const user = await verifiedUser();
    const apps = await Promise.all(Array.from({ length: 6 }, () => readyApp(user)));
    const results = await Promise.all(apps.map((appId) => start(user, appId)));
    expect(results.filter((result) => result.status === 201)).toHaveLength(3);
    expect(results.filter((result) => result.status === 429)).toHaveLength(3);
  });
});

describe('F09 AC11: hardening', () => {
  it('refuses a missing CSRF token, extra fields and bad values', async () => {
    const user = await verifiedUser();
    const appId = await readyApp(user);
    expect((await user.post(`/apps/${appId}/builds`, { idempotencyKey: key() }, { csrf: null })).status).toBe(403);
    expect((await start(user, appId, { idempotencyKey: key(), plan: 'premium' })).status).toBe(400);
    expect((await start(user, appId, { idempotencyKey: 'short' })).status).toBe(400);
    expect((await start(user, appId, { idempotencyKey: key(), versionName: '1.0; rm -rf /' })).status).toBe(400);
    expect((await h.client().post(`/apps/${appId}/builds`, { idempotencyKey: key() })).status).toBe(401);
  });

  it('limits rapid starts', async () => {
    const limited = await makeHarness({ routeLimit: 5 });
    const user = await verifiedUser(limited);
    const statuses: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      statuses.push((await user.post(`/apps/${new ObjectId()}/builds`, { idempotencyKey: key() })).status);
    }
    expect(statuses.at(-1)).toBe(429);
    await limited.close();
  });
});

describe('F09 AC9: history on the apps page', () => {
  it('shows each app’s latest build, and its last 10 builds newest first', async () => {
    const user = await verifiedUser();
    const appId = await readyApp(user);
    const first = await start(user, appId);
    await finish(first.body.id);
    await h.builds.updateOne({ _id: first.body.id }, { $set: { countsTowardLimit: false } });
    const second = await start(user, appId);

    const list = await (await user.get('/apps')).json();
    expect(list.find((app: { id: string }) => app.id === appId).latestBuild).toMatchObject({ id: second.body.id, status: 'queued' });

    const history = await (await user.get(`/apps/${appId}/builds`)).json();
    expect(history.map((build: { id: string }) => build.id)).toEqual([second.body.id, first.body.id]);
    expect((await (await verifiedUser()).get(`/apps/${appId}/builds`)).status).toBe(404);
  });
});
