import { randomBytes } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createKeystoreOnce, parseKeyring, prepareKeystores, scheduleErase, readKeystore } from '@sitetoapk/shared/keystore';
import { keyUpkeep } from '../src/key-upkeep';

const mongo = await new MongoClient('mongodb://127.0.0.1:27017').connect();
const db = mongo.db('sitetoapk_test_upkeep');
const keystores = await prepareKeystores(db);
const users = db.collection('users');
const apps = db.collection('apps');
const ring = parseKeyring(`1:${randomBytes(32).toString('base64')}`);
const DAY = 24 * 60 * 60 * 1000;

let sent: { to: string; subject: string; text: string }[] = [];
const mail = async (to: string, subject: string, text: string) => void sent.push({ to, subject, text });

const secrets = { alias: 'a', storePassword: 'p', keyPassword: 'p', keystore: Buffer.from('jks') };
const prints = { sha1: 'AA', sha256: 'BB' };

const makeKey = async (createdDaysAgo: number) => {
  const ownerId = new ObjectId();
  const appId = new ObjectId();
  await users.insertOne({ _id: ownerId, email: `${appId}@example.com`, emailVerifiedAt: new Date() });
  await apps.insertOne({ _id: appId, draft: { appName: 'Shop' } });
  await createKeystoreOnce(keystores, ring, appId, secrets, prints, ownerId);
  await keystores.updateOne({ appId }, { $set: { createdAt: new Date(Date.now() - createdDaysAgo * DAY) } });
  return { ownerId, appId };
};
const run = () => keyUpkeep({ keystores, users, apps, mail, appUrl: 'https://site.test' });

beforeEach(async () => {
  sent = [];
  await Promise.all([keystores.deleteMany({}), users.deleteMany({}), apps.deleteMany({})]);
});
afterAll(async () => {
  await db.dropDatabase();
  await mongo.close();
});

describe('AC13: backup reminders', () => {
  it('sends nothing before a day has passed', async () => {
    await makeKey(0.5);
    expect(await run()).toMatchObject({ reminders: 0 });
    expect(sent).toHaveLength(0);
  });

  it('sends one reminder after a day and one after a week, and no more', async () => {
    const { appId } = await makeKey(1.2);
    await run();
    await run();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toContain('Shop');
    expect(sent[0]!.text).toContain(`https://site.test/my-apps/${appId}/review`);

    await keystores.updateOne({ appId }, { $set: { createdAt: new Date(Date.now() - 8 * DAY) } });
    await run();
    await run();
    expect(sent).toHaveLength(2);
  });

  it('stops once the key has been downloaded', async () => {
    const { appId } = await makeKey(8);
    await keystores.updateOne({ appId }, { $set: { downloadedAt: new Date() } });
    await run();
    expect(sent).toHaveLength(0);
  });

  it('tries again later when the email fails, without losing the reminder', async () => {
    await makeKey(2);
    const failing = () => keyUpkeep({ keystores, users, apps, appUrl: 'x', mail: async () => { throw new Error('down'); } });
    await failing();
    expect(sent).toHaveLength(0);
    await run();
    expect(sent).toHaveLength(1);
  });
});

describe('AC14: the key is erased 7 days after deletion', () => {
  it('keeps the key during the wait, tells the owner, then erases it', async () => {
    const { appId } = await makeKey(2);
    await keystores.updateOne({ appId }, { $set: { remindersSent: 2 } });
    await scheduleErase(keystores, { appId });

    expect(await run()).toMatchObject({ notices: 1, erased: 0 });
    expect(sent[0]!.subject).toContain('will be erased');
    expect(await readKeystore(keystores, ring, appId)).not.toBeNull();

    const later = new Date(Date.now() + 8 * DAY);
    expect(await keyUpkeep({ keystores, users, apps, mail, appUrl: 'x', now: later })).toMatchObject({ erased: 1 });
    expect(await readKeystore(keystores, ring, appId)).toBeNull();
  });

  it('keeps the first date when erasing is scheduled twice', async () => {
    const { appId } = await makeKey(0);
    await scheduleErase(keystores, { appId }, new Date(Date.now()));
    const first = (await keystores.findOne({ appId }))!.deleteAfter;
    await scheduleErase(keystores, { appId }, new Date(Date.now() + 5 * DAY));
    expect((await keystores.findOne({ appId }))!.deleteAfter).toEqual(first);
  });
});
