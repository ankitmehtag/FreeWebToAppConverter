import { ObjectId } from 'mongodb';
import { MongoClient } from 'mongodb';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildExpiryReminders } from '../src/build-expiry';

const mongo = await new MongoClient('mongodb://127.0.0.1:27017').connect();
const db = mongo.db('sitetoapk_test_expiry');
const builds = db.collection('builds');
const users = db.collection('users');
afterAll(async () => {
  await db.dropDatabase();
  await mongo.close();
});
beforeEach(async () => {
  await builds.deleteMany({});
  await users.deleteMany({});
});

const DAY = 24 * 60 * 60 * 1000;
let sent: { to: string; subject: string; text: string; html?: string }[] = [];
const mail = async (to: string, subject: string, text: string, html?: string) => void sent.push({ to, subject, text, html });
const run = () => buildExpiryReminders({ builds, users, mail, appUrl: 'https://site.test' });

const makeBuild = async (over: Record<string, unknown> = {}, expiresInHours = 12) => {
  const ownerId = new ObjectId();
  const appId = new ObjectId();
  await users.insertOne({ _id: ownerId, email: `${appId}@example.com`, emailVerifiedAt: new Date() });
  const _id = new ObjectId().toHexString();
  await builds.insertOne({ _id: _id as never, appId, ownerId, status: 'success', plan: 'free', artifactKey: 'free/x.apk', config: { appName: 'Shop' }, createdAt: new Date(Date.now() - 6 * DAY), expiresAt: new Date(Date.now() + expiresInHours * 3600 * 1000), ...over });
  return { _id, appId, ownerId };
};

describe('AC6: Free build expiring', () => {
  beforeEach(() => { sent = []; });

  it('sends once when the build expires within a day, even if the job runs twice', async () => {
    const { ownerId } = await makeBuild();
    await run();
    await run();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ subject: 'Your Shop build is deleted soon' });
    expect(sent[0]!.html).toContain('Download the app');
    expect(String((await users.findOne({ _id: ownerId }))!.email)).toBe(sent[0]!.to);
  });
  it('sends nothing when the build was downloaded', async () => {
    await makeBuild({ apkDownloadedAt: new Date() });
    await run();
    expect(sent).toHaveLength(0);
  });
  it('sends nothing when the build expires later than a day or is Premium', async () => {
    await makeBuild({}, 40);
    await makeBuild({ plan: 'premium', expiresAt: null });
    await run();
    expect(sent).toHaveLength(0);
  });
  it('sends nothing for an older build of an app that has a newer one', async () => {
    const { appId, ownerId } = await makeBuild();
    await builds.insertOne({ _id: 'newer' as never, appId, ownerId, status: 'success', plan: 'free', createdAt: new Date(), config: { appName: 'Shop' } });
    await run();
    expect(sent).toHaveLength(0);
  });
  it('gives the claim back when the send fails, so the next run tries again', async () => {
    const { _id } = await makeBuild();
    await buildExpiryReminders({ builds, users, appUrl: 'https://site.test', mail: async () => { throw new Error('down'); } });
    expect((await builds.findOne({ _id: _id as never }))?.expiryReminderSent).toBe(false);
    await run();
    expect(sent).toHaveLength(1);
  });
  it('skips an unverified owner', async () => {
    const { ownerId } = await makeBuild();
    await users.updateOne({ _id: ownerId }, { $unset: { emailVerifiedAt: '' } });
    await run();
    expect(sent).toHaveLength(0);
  });
});
