import { Redis } from 'ioredis';
import { MongoClient } from 'mongodb';
import { createApp } from './app';

const requireEnv = (name: string) => {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing environment variable ${name}`);
    process.exit(1);
  }
  return value;
};

const port = Number(process.env.PORT ?? 3000);

const mongo = new MongoClient(requireEnv('MONGO_URL'), { serverSelectionTimeoutMS: 1500 });

// With the offline queue off, a ping fails at once while Redis is down.
const redis = new Redis(requireEnv('REDIS_URL'), {
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
  retryStrategy: (attempt) => Math.min(attempt * 200, 2000),
});
redis.on('error', () => {});

const app = createApp({
  checkMongo: async () => {
    await mongo.db().command({ ping: 1 });
  },
  checkRedis: async () => {
    await redis.ping();
  },
});

const server = app.listen(port, () => console.log(`API listening on port ${port}`));

const shutdown = () => {
  server.close(async () => {
    redis.disconnect();
    await mongo.close();
    process.exit(0);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
