import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Db } from 'mongodb';
import type { IconStore } from '../apps/icons';

export type BuildsConfig = {
  /** Builds a Free user may start in any rolling window. */
  dailyLimit: number;
  windowMs: number;
  /** How often an open event stream re-reads the build, in case a final status was missed. */
  pollMs?: number;
  /** Where install links point. Defaults to the app's own address; local tests set the Mac's LAN address, which a phone can reach. */
  installUrl?: string;
};

/** One Redis connection for every open event stream, fanned out by channel. */
const createHub = (redis: Redis) => {
  const subscriber = redis.duplicate();
  subscriber.on('error', () => {});
  const listeners = new Map<string, Set<(message: string) => void>>();
  subscriber.on('message', (channel, message) => listeners.get(channel)?.forEach((listener) => listener(message)));

  return {
    listen: async (channel: string, listener: (message: string) => void) => {
      let set = listeners.get(channel);
      if (!set) {
        set = new Set();
        listeners.set(channel, set);
        await subscriber.subscribe(channel);
      }
      set.add(listener);
      return () => {
        set!.delete(listener);
        if (set!.size === 0 && listeners.get(channel) === set) {
          listeners.delete(channel);
          void subscriber.unsubscribe(channel).catch(() => undefined);
        }
      };
    },
    close: () => subscriber.disconnect(),
  };
};

type BuildsOptions = { db: Db; redis: Redis; queue: Pick<Queue, 'add'>; storage: IconStore; config: BuildsConfig };

/** Creates indexes and returns what the build routes need. */
export const prepareBuilds = async ({ db, redis, queue, storage, config }: BuildsOptions) => {
  const builds = db.collection('builds');
  const buildLogs = db.collection('buildLogs');
  const installTokens = db.collection('installTokens');

  // Only live builds carry it, so an app can hold just one at a time.
  await builds.createIndex({ activeAppId: 1 }, { unique: true, sparse: true });
  await builds.createIndex(
    { ownerId: 1, idempotencyKey: 1 },
    { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } },
  );
  await builds.createIndex({ ownerId: 1, createdAt: -1 });
  await builds.createIndex({ appId: 1, createdAt: -1 });
  await installTokens.createIndex({ hash: 1 }, { unique: true });
  await installTokens.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

  return { builds, buildLogs, installTokens, redis, queue, storage, config, hub: createHub(redis) };
};

export type Builds = Awaited<ReturnType<typeof prepareBuilds>>;
