import type { Db } from 'mongodb';
import type { IconStore } from './icons';

export const MAX_APPS_PER_USER = 20;

/** Creates indexes and returns what the app routes need. */
export const prepareApps = async (db: Db, icons: IconStore) => {
  const apps = db.collection('apps');

  // Enforces one package name per user even across parallel saves.
  await apps.createIndex(
    { ownerId: 1, 'draft.packageName': 1 },
    { unique: true, partialFilterExpression: { 'draft.packageName': { $type: 'string' } } },
  );
  await apps.createIndex({ ownerId: 1, updatedAt: -1 });

  return { apps, icons };
};

export type Apps = Awaited<ReturnType<typeof prepareApps>>;
