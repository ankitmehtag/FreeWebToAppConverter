import type { Db } from 'mongodb';
import type { IconStore } from './icons';

export const MAX_APPS_PER_USER = 20;

/** Creates indexes and returns what the app routes need. */
export const PUSH_PER_DAY = 5;
const DAY_SECONDS = 24 * 60 * 60;

export type SendPush = (appId: string, message: { title: string; body: string }) => Promise<void>;

export const prepareApps = async (db: Db, icons: IconStore, sendPush?: SendPush) => {
  const apps = db.collection('apps');

  // Enforces one package name per user even across parallel saves.
  await apps.createIndex(
    { ownerId: 1, 'draft.packageName': 1 },
    { unique: true, partialFilterExpression: { 'draft.packageName': { $type: 'string' } } },
  );
  await apps.createIndex({ ownerId: 1, updatedAt: -1 });

  // One row per notification sent, so the daily limit is a count. Rows expire after a day.
  const pushes = db.collection('pushes');
  await pushes.createIndex({ at: 1 }, { expireAfterSeconds: DAY_SECONDS });
  await pushes.createIndex({ appId: 1 });

  return { apps, icons, pushes, sendPush };
};

export type Apps = Awaited<ReturnType<typeof prepareApps>>;
