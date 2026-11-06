import type { Queue } from 'bullmq';
import type { Collection, ObjectId } from 'mongodb';
import type { AppConfig } from './app-config';

export const QUEUE_NAME = 'builds';
export const ACTIVE_STATUSES = ['building', 'signing', 'uploading'];
/** Statuses that hold the app's one build slot. */
export const LIVE_STATUSES = ['queued', ...ACTIVE_STATUSES];
export const FINAL_STATUSES = ['success', 'failed', 'canceled'];

/** Why a build failed. Only `infra` is our fault, so only it is retried and left out of the daily limit. */
export type FailureKind = 'input' | 'compile' | 'timeout' | 'check' | 'infra';

export type BuildRequest = {
  _id: string;
  config: AppConfig;
  plan: 'free' | 'premium';
  versionCode: number;
  versionName: string;
  /** A local icon file, used by the build-app script. */
  iconPath?: string;
  /** The icon copy in storage, used by builds started from the website. */
  iconKey?: string;
  appId?: ObjectId;
  ownerId?: ObjectId;
  idempotencyKey?: string;
};

export const BUILD_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: true,
  removeOnFail: true,
} as const;

export const createBuild = async (builds: Collection, request: BuildRequest) => {
  const now = new Date();
  await builds.insertOne({
    ...request,
    _id: request._id as never,
    // Unique while set, so an app holds at most one live build.
    ...(request.appId ? { activeAppId: request.appId } : {}),
    status: 'queued',
    history: ['queued'],
    createdAt: now,
    updatedAt: now,
  });
  return request._id;
};

export const queueBuild = (queue: Queue, buildId: string) => queue.add('build', { buildId }, { ...BUILD_JOB_OPTIONS, jobId: buildId });

export const enqueueBuild = async (builds: Collection, queue: Queue, request: BuildRequest) => {
  await createBuild(builds, request);
  await queueBuild(queue, request._id);
  return request._id;
};

/** Moves a build on. A final status frees the app's build slot. */
export const setStatus = (builds: Collection, id: string, status: string, fields: object = {}) =>
  builds.updateOne(
    { _id: id as never },
    {
      $set: { status, updatedAt: new Date(), ...fields },
      $push: { history: status } as never,
      ...(FINAL_STATUSES.includes(status) ? { $unset: { activeAppId: '' } } : {}),
    },
  );

/** Lines kept for a build: live in Redis, then in `buildLogs`. */
export const MAX_LOG_LINES = 2000;
export const LIVE_LOG_TTL_SECONDS = 60 * 60;

export const logChannel = (buildId: string) => `build:${buildId}`;
export const logLinesKey = (buildId: string) => `build:${buildId}:lines`;
export const logSeqKey = (buildId: string) => `build:${buildId}:seq`;

/** A stored or streamed log line. `n` rises by one per line, so a viewer can drop repeats. */
export type LogLine = { n: number; text: string };

export type BuildEvent =
  | ({ type: 'line' } & LogLine)
  | { type: 'status'; status: string; failureKind?: FailureKind };
