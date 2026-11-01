import type { Collection } from 'mongodb';
import type { Queue } from 'bullmq';
import type { AppConfig } from '@sitetoapk/shared';

export const QUEUE_NAME = 'builds';
export const ACTIVE_STATUSES = ['building', 'signing', 'uploading'];

export type BuildRequest = {
  _id: string;
  config: AppConfig;
  iconPath: string;
  plan: 'free' | 'premium';
  versionCode: number;
  versionName: string;
};

export const createBuild = async (builds: Collection, request: BuildRequest) => {
  const now = new Date();
  await builds.insertOne({ ...request, _id: request._id as never, status: 'queued', history: ['queued'], createdAt: now, updatedAt: now });
  return request._id;
};

export const enqueueBuild = async (builds: Collection, queue: Queue, request: BuildRequest) => {
  await createBuild(builds, request);
  await queue.add('build', { buildId: request._id }, {
    jobId: request._id,
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: true,
    removeOnFail: true,
  });
  return request._id;
};

export const setStatus = (builds: Collection, id: string, status: string, fields: object = {}) =>
  builds.updateOne(
    { _id: id as never },
    { $set: { status, updatedAt: new Date(), ...fields }, $push: { history: status } as never },
  );
