import { Worker, type ConnectionOptions } from 'bullmq';
import { processBuild, type BuildDeps } from './build';
import { QUEUE_NAME } from './builds';

export const startWorker = (
  deps: BuildDeps,
  { connection, concurrency, queueName = QUEUE_NAME }: { connection: ConnectionOptions; concurrency: number; queueName?: string },
) =>
  new Worker(
    queueName,
    (job) => processBuild(deps, job.data.buildId, { attemptsMade: job.attemptsMade, attempts: job.opts.attempts ?? 1 }),
    { connection, concurrency, maxStalledCount: 2 },
  );
