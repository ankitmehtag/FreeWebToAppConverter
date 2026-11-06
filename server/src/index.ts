import { Redis } from 'ioredis';
import { MongoClient } from 'mongodb';
import { createApp } from './app';
import { prepareApps } from './apps';
import { createIconStore } from './apps/icons';
import { prepareAuth } from './auth';
import { resendMailer, smtpMailer } from './auth/mailer';
import { createFetcher } from './url/fetcher';

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

const jwtSecret = requireEnv('JWT_SECRET');
if (jwtSecret.length < 32) {
  console.error('JWT_SECRET must be at least 32 characters');
  process.exit(1);
}

const mailFrom = requireEnv('MAIL_FROM');
const resendKey = process.env.RESEND_API_KEY;
const googleId = process.env.GOOGLE_CLIENT_ID;

await mongo.connect();
const auth = await prepareAuth({
  db: mongo.db(),
  redis,
  mailer: resendKey ? resendMailer(resendKey, mailFrom) : smtpMailer(requireEnv('SMTP_URL'), mailFrom),
  config: {
    jwtSecret,
    appUrl: requireEnv('APP_URL'),
    apiUrl: requireEnv('API_URL'),
    bcryptCost: 12,
    accessTtlSeconds: 15 * 60,
    refreshTtlSeconds: 30 * 24 * 60 * 60,
    verifyTtlMs: 24 * 60 * 60 * 1000,
    resetTtlMs: 60 * 60 * 1000,
    lockThreshold: 5,
    lockMs: 15 * 60 * 1000,
    ipFailLimit: 50,
    routeLimit: 10,
    routeWindowMs: 15 * 60 * 1000,
    google: googleId
      ? {
          clientId: googleId,
          clientSecret: requireEnv('GOOGLE_CLIENT_SECRET'),
          authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
          tokenUrl: 'https://oauth2.googleapis.com/token',
          jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
          issuer: 'https://accounts.google.com',
        }
      : undefined,
  },
});

const app = createApp({
  checkMongo: async () => {
    await mongo.db().command({ ping: 1 });
  },
  checkRedis: async () => {
    await redis.ping();
  },
  auth,
  fetchUrl: createFetcher(),
  apps: await prepareApps(
    mongo.db(),
    createIconStore({
      endpoint: requireEnv('R2_ENDPOINT'),
      bucket: requireEnv('R2_BUCKET'),
      accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
    }),
  ),
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
