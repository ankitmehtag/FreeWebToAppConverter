import { createHash, randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBuild, logChannel, logLinesKey, setStatus, type BuildEvent } from '@sitetoapk/shared/builds';
import { APP_URL, makeHarness, signedIn } from './auth-helpers';

type Harness = Awaited<ReturnType<typeof makeHarness>>;
type User = Awaited<ReturnType<typeof signedIn>>;
let h: Harness;
beforeAll(async () => { h = await makeHarness({}, undefined, { pollMs: 200 }); });
afterAll(() => h.close());

const email = () => `u${Math.random().toString(36).slice(2)}@example.com`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const config = {
  schemaVersion: 1 as const,
  startUrl: 'https://example.com/',
  packageName: 'com.example.app',
  appName: 'Example',
  internalHosts: ['example.com'],
  ui: { statusBarColor: '#0F172A', orientation: 'unspecified' as const, zoom: false, progressBar: true, pullToRefresh: true, exitDialog: true },
};

/** A build record owned by this user's session, as the start route would leave it. */
const buildFor = async (user: User, fields: object = {}) => {
  const me = await h.users.findOne({ email: (await (await user.get('/auth/me')).json()).email });
  const id = randomUUID();
  const appId = new ObjectId();
  await createBuild(h.builds, { _id: id, config, plan: 'free', versionCode: 1, versionName: '1.0', appId, ownerId: me!._id });
  if (Object.keys(fields).length) await h.builds.updateOne({ _id: id as never }, { $set: fields });
  return { id, appId };
};

/** What the worker does for each line. */
let seq = 0;
const workerLine = async (id: string, text: string) => {
  seq += 1;
  await h.redis.rpush(logLinesKey(id), JSON.stringify({ n: seq, text }));
  await h.redis.publish(logChannel(id), JSON.stringify({ type: 'line', n: seq, text }));
};
const workerStatus = async (id: string, status: string) => {
  await setStatus(h.builds, id, status);
  await h.redis.publish(logChannel(id), JSON.stringify({ type: 'status', status }));
};

/** Reads an event stream until it ends, or until the time runs out. */
const readEvents = async (user: User, id: string, whileOpen: () => Promise<void> = async () => {}, timeoutMs = 3000) => {
  const response = await user.get(`/builds/${id}/events`);
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('text/event-stream');
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const events: (BuildEvent | { type: 'end' })[] = [];
  let text = '';
  const reading = (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      text += decoder.decode(value, { stream: true });
      const blocks = text.split('\n\n');
      text = blocks.pop() ?? '';
      for (const block of blocks) {
        const data = /^data: (.*)$/m.exec(block)?.[1];
        const type = /^event: (.*)$/m.exec(block)?.[1];
        if (type === 'end') events.push({ type: 'end' });
        else if (data) events.push(JSON.parse(data));
      }
    }
  })();
  await whileOpen();
  await Promise.race([reading, sleep(timeoutMs).then(() => reader.cancel())]);
  return events;
};

const linesOf = (events: { type: string }[]) => events.filter((event): event is BuildEvent & { type: 'line' } => event.type === 'line').map((event) => event.text);
const statusesOf = (events: { type: string }[]) => events.filter((event): event is BuildEvent & { type: 'status' } => event.type === 'status').map((event) => event.status);

describe('F09 AC6: following a build', () => {
  it('shows earlier lines first to a late viewer, then live lines and statuses, then ends', async () => {
    const user = await signedIn(h, email());
    const { id } = await buildFor(user);
    await workerStatus(id, 'building');
    await workerLine(id, 'one');
    await workerLine(id, 'two');

    const events = await readEvents(user, id, async () => {
      await sleep(150);
      await workerLine(id, 'three');
      await workerStatus(id, 'signing');
      await workerStatus(id, 'success');
    });
    expect(linesOf(events)).toEqual(['one', 'two', 'three']);
    expect(statusesOf(events)).toEqual(['building', 'signing', 'success']);
    expect(events.at(-1)).toEqual({ type: 'end' });
  });

  it('replays a finished build from its kept log, and ends', async () => {
    const user = await signedIn(h, email());
    const { id } = await buildFor(user);
    await setStatus(h.builds, id, 'failed', { failureKind: 'compile' });
    await h.db.collection('buildLogs').insertOne({ _id: id as never, lines: [{ n: 1, text: 'e: broken' }] });
    const events = await readEvents(user, id);
    expect(linesOf(events)).toEqual(['e: broken']);
    expect(events.find((event) => event.type === 'status')).toMatchObject({ status: 'failed', failureKind: 'compile' });
    expect(events.at(-1)).toEqual({ type: 'end' });
  });

  it('notices an end it wasn’t told about, such as the reaper’s', async () => {
    const user = await signedIn(h, email());
    const { id } = await buildFor(user);
    await setStatus(h.builds, id, 'building');
    const events = await readEvents(user, id, async () => {
      await sleep(100);
      await setStatus(h.builds, id, 'failed', { failureKind: 'timeout' });
    });
    expect(statusesOf(events)).toEqual(['building', 'failed']);
  });

  it('answers 404 to another user and to a signed-out visitor gets 401', async () => {
    const owner = await signedIn(h, email());
    const { id } = await buildFor(owner);
    const stranger = await signedIn(h, email());
    expect((await stranger.get(`/builds/${id}/events`)).status).toBe(404);
    expect((await stranger.get(`/builds/${id}`)).status).toBe(404);
    expect((await h.client().get(`/builds/${id}/events`)).status).toBe(401);
  });
});

const apk = Buffer.alloc(64 * 1024, 5);
const sha = createHash('sha256').update(apk).digest('hex');

const successfulBuild = async (user: User, expiresAt = new Date(Date.now() + 60_000)) => {
  const built = await buildFor(user);
  const artifactKey = `free/${built.id}.apk`;
  await h.icons.put(artifactKey, apk);
  await setStatus(h.builds, built.id, 'success', { artifactKey, artifactBytes: apk.length, sha256: sha, expiresAt });
  return built;
};

describe('F09 AC9: download and history', () => {
  it('redirects the owner to a short link whose file matches the SHA-256', async () => {
    const user = await signedIn(h, email());
    const { id } = await successfulBuild(user);
    const response = await user.get(`/builds/${id}/download`);
    expect(response.status).toBe(302);
    const link = new URL(response.headers.get('location')!);
    expect(link.searchParams.get('X-Amz-Expires')).toBe('3600');
    const file = Buffer.from(await (await fetch(link)).arrayBuffer());
    expect(createHash('sha256').update(file).digest('hex')).toBe(sha);
  });

  it('answers 404 to another user', async () => {
    const owner = await signedIn(h, email());
    const { id } = await successfulBuild(owner);
    expect((await (await signedIn(h, email())).get(`/builds/${id}/download`)).status).toBe(404);
  });

  it('says an expired build has expired', async () => {
    const user = await signedIn(h, email());
    const { id } = await successfulBuild(user, new Date(Date.now() - 1000));
    const response = await user.get(`/builds/${id}/download`);
    expect(response.status).toBe(410);
    expect((await response.json()).error).toMatch(/expired/);
    expect((await (await user.get(`/builds/${id}`)).json()).expired).toBe(true);
  });

  it('refuses a build that has no APK', async () => {
    const user = await signedIn(h, email());
    const { id } = await buildFor(user);
    expect((await user.get(`/builds/${id}/download`)).status).toBe(409);
  });
});

describe('F09 AC10: install links', () => {
  const newLink = async (user: User, id: string) => {
    const response = await user.post(`/builds/${id}/install-link`);
    expect(response.status).toBe(201);
    const { url } = await response.json();
    return new URL(url).pathname.split('/').pop()!;
  };

  it('opens the install page, icon and download without signing in, and stores only a hash', async () => {
    const user = await signedIn(h, email());
    const { id } = await successfulBuild(user);
    await h.icons.put(`builds/${id}/icon.png`, Buffer.from('icon-bytes'));
    const response = await user.post(`/builds/${id}/install-link`);
    const { url } = await response.json();
    expect(url).toMatch(new RegExp(`^${APP_URL}/install/[\\w-]{43}$`));
    const token = url.split('/').pop();
    expect(JSON.stringify(await h.db.collection('installTokens').find().toArray())).not.toContain(token);

    const phone = h.client();
    expect(await (await phone.get(`/builds/install/${token}`)).json()).toEqual({
      appName: 'Example', versionName: '1.0', versionCode: 1, artifactBytes: apk.length,
    });
    expect((await phone.get(`/builds/install/${token}/icon`)).status).toBe(200);
    const download = await phone.get(`/builds/install/${token}/download`);
    expect(download.status).toBe(302);
    const file = Buffer.from(await (await fetch(download.headers.get('location')!)).arrayBuffer());
    expect(createHash('sha256').update(file).digest('hex')).toBe(sha);
  });

  it('stops working after an hour, and once the APK is deleted', async () => {
    const user = await signedIn(h, email());
    const { id } = await successfulBuild(user);
    const phone = h.client();

    const old = await newLink(user, id);
    await h.db.collection('installTokens').updateMany({ buildId: id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await phone.get(`/builds/install/${old}`)).status).toBe(410);
    expect((await phone.get(`/builds/install/${old}/download`)).status).toBe(410);

    const fresh = await newLink(user, id);
    expect((await phone.get(`/builds/install/${fresh}`)).status).toBe(200);
    await h.builds.updateOne({ _id: id as never }, { $unset: { artifactKey: '' }, $set: { artifactDeletedAt: new Date() } });
    expect((await phone.get(`/builds/install/${fresh}`)).status).toBe(410);
    expect((await phone.get(`/builds/install/not-a-real-token-at-all-not-a-real-token-xx`)).status).toBe(410);
  });

  it('is made only by the owner, with a CSRF token, for a build with an APK', async () => {
    const owner = await signedIn(h, email());
    const { id } = await successfulBuild(owner);
    expect((await (await signedIn(h, email())).post(`/builds/${id}/install-link`)).status).toBe(404);
    expect((await owner.post(`/builds/${id}/install-link`, {}, { csrf: null })).status).toBe(403);
    const { id: running } = await buildFor(owner);
    expect((await owner.post(`/builds/${running}/install-link`)).status).toBe(409);
  });
});

describe('F09 AC10: install page limits', () => {
  it('limits downloads, but not opening the page and icon', async () => {
    const limited = await makeHarness({ routeLimit: 2 });
    const owner = await signedIn(limited, email());
    const me = await limited.users.findOne({});
    const id = randomUUID();
    await createBuild(limited.builds, { _id: id, config, plan: 'free', versionCode: 1, versionName: '1.0', appId: new ObjectId(), ownerId: me!._id });
    await limited.icons.put(`free/${id}.apk`, apk);
    await limited.icons.put(`builds/${id}/icon.png`, Buffer.from('icon'));
    await setStatus(limited.builds, id, 'success', { artifactKey: `free/${id}.apk`, artifactBytes: apk.length, sha256: sha, expiresAt: new Date(Date.now() + 60_000) });
    const { url } = await (await owner.post(`/builds/${id}/install-link`)).json();
    const token = url.split('/').pop();
    const phone = limited.client();
    for (let i = 0; i < 5; i += 1) {
      expect((await phone.get(`/builds/install/${token}`)).status).toBe(200);
      expect((await phone.get(`/builds/install/${token}/icon`)).status).toBe(200);
    }
    const downloads = [];
    for (let i = 0; i < 3; i += 1) downloads.push((await phone.get(`/builds/install/${token}/download`)).status);
    expect(downloads).toEqual([302, 302, 429]);
    await limited.close();
  });
});
