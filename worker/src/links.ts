import type { Collection } from 'mongodb';
import { LINK_LIFETIME_SECONDS, type Storage } from './storage';

type LinkDeps = { builds: Collection; storage: Storage };

/** Issues a signed download link. Callers must already have checked ownership. */
export const createDownloadLink = async ({ builds, storage }: LinkDeps, buildId: string, lifetimeSeconds = LINK_LIFETIME_SECONDS) => {
  const build = await builds.findOne({ _id: buildId as never });
  if (build?.status !== 'success' || !build.artifactKey) throw new Error('Artifact not available');
  if (build.expiresAt <= new Date()) throw new Error('Artifact expired');
  return storage.signedLink(build.artifactKey, lifetimeSeconds);
};

/** Removes the object, which also stops every link already issued for it. */
export const deleteArtifact = async ({ builds, storage }: LinkDeps, buildId: string) => {
  const build = await builds.findOne({ _id: buildId as never });
  if (!build?.artifactKey) return;
  await storage.remove(build.artifactKey);
  await builds.updateOne({ _id: buildId as never }, { $unset: { artifactKey: '' }, $set: { artifactDeletedAt: new Date() } });
};
