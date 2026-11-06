import type { Db, ObjectId } from 'mongodb';
import { setStatus } from '@sitetoapk/shared/builds';
import type { IconStore } from '../apps/icons';

type TakedownDeps = { db: Db; storage: Pick<IconStore, 'remove'> };
type Action = { reason: string; operator: string };

/**
 * Takes one app down: no more builds or edits, and every APK it ever produced is deleted, which
 * also stops every download and install link for it. The record is kept for the admin panel (F17).
 */
export const takeDown = async ({ db, storage }: TakedownDeps, appId: ObjectId, { reason, operator }: Action) => {
  const apps = db.collection('apps');
  const builds = db.collection('builds');
  const app = await apps.findOne({ _id: appId });
  if (!app) throw new Error('No app with that id');

  const at = new Date();
  // Set first, so a build that is running now can't publish its APK (the worker checks before upload).
  await apps.updateOne({ _id: appId }, { $set: { takenDown: { reason, at, by: operator } } });

  for (const build of await builds.find({ appId, status: 'queued' }).toArray()) {
    await setStatus(builds, String(build._id), 'canceled', { error: 'App taken down' });
  }

  const deleted: string[] = [];
  const all = await builds.find({ appId }).toArray();
  for (const build of all.filter((item) => item.artifactKey)) {
    await storage.remove(build.artifactKey);
    await builds.updateOne({ _id: build._id }, { $unset: { artifactKey: '' }, $set: { artifactDeletedAt: at } });
    deleted.push(build.artifactKey);
  }
  await db.collection('installTokens').deleteMany({ buildId: { $in: all.map((build) => build._id) } });

  await db.collection('takedowns').insertOne({ appId, ownerId: app.ownerId, action: 'takedown', reason, operator, at, deleted });
  return { deleted };
};

/** Allows new builds and edits again. APKs deleted by the takedown stay deleted. */
export const restore = async ({ db }: Pick<TakedownDeps, 'db'>, appId: ObjectId, { reason, operator }: Action) => {
  const apps = db.collection('apps');
  const app = await apps.findOne({ _id: appId });
  if (!app?.takenDown) throw new Error('That app is not taken down');
  await apps.updateOne({ _id: appId }, { $unset: { takenDown: '' } });
  await db.collection('takedowns').insertOne({ appId, ownerId: app.ownerId, action: 'restore', reason, operator, at: new Date(), deleted: [] });
};
