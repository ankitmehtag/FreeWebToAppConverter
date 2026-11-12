import { createHmac, randomBytes } from 'node:crypto';
import { expect } from 'vitest';
import { parseKeyring, prepareKeystores } from '@sitetoapk/shared/keystore';
import type { Screenshot } from '../src/url/screenshot';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { CreateBucketCommand } from '@aws-sdk/client-s3';
import { Redis } from 'ioredis';
import { MongoClient } from 'mongodb';
import { prepareOrders } from '../src/payments/orders';
import type { Payments } from '../src/payments/routes';
import { verifyRazorpayWebhook } from '../src/payments/razorpay';
import type { CheckoutInput, PaymentProvider } from '../src/payments/provider';
import { prepareAdmin } from '../src/admin';
import { codeNow, newSecret, seal } from '../src/admin/totp';
import { createApp } from '../src/app';
import { prepareApps } from '../src/apps';
import { createIconStore } from '../src/apps/icons';
import { prepareBuilds, type BuildsConfig } from '../src/builds';
import { createUnsafeChecker, type UnsafeLookup } from '../src/abuse/unsafe';
import { prepareReports } from '../src/abuse/reports';
import { s3Client } from '@sitetoapk/shared/s3';
import type { AuthConfig, Mail } from '../src/auth/types';
import { prepareAuth } from '../src/auth';
import type { FetchUrl } from '../src/url/fetcher';

export const APP_URL = 'http://app.test';
export const WEBHOOK_SECRET = 'whsec_test_secret';
export const ADMIN_EMAIL = 'admin@example.com';
export const KEY_SECRET = 'key_secret_for_tests';

// The local S3 from Compose stands in for R2. Its credentials are local only.
export const localS3 = {
  endpoint: 'http://127.0.0.1:9000',
  accessKeyId: 'sitetoapk-local',
  secretAccessKey: 'sitetoapk-local-only',
  pathStyle: true,
};

// One bucket for every run: each bucket takes its own volumes, and the local S3 runs out of them.
// Icon keys hold the app id, so runs never collide.
const ICON_BUCKET = 'test-icons';

const testIconStore = async () => {
  const bucket = ICON_BUCKET;
  try {
    await s3Client({ ...localS3, bucket }).send(new CreateBucketCommand({ Bucket: bucket }));
  } catch (error) {
    if ((error as Error).name !== 'BucketAlreadyOwnedByYou' && (error as Error).name !== 'BucketAlreadyExists') throw error;
  }
  return { bucket, icons: createIconStore({ ...localS3, bucket }) };
};

export const makeHarness = async (
  config: Partial<AuthConfig> = {},
  fetchUrl?: FetchUrl,
  buildsConfig: Partial<BuildsConfig> = {},
  { trustProxy, unsafeLookup, screenshot }: { trustProxy?: string; unsafeLookup?: UnsafeLookup; screenshot?: Screenshot } = {},
) => {
  const mongo = await new MongoClient('mongodb://127.0.0.1:27017').connect();
  const db = mongo.db(`auth_test_${randomUUID().slice(0, 8)}`);
  const redis = new Redis('redis://127.0.0.1:6379', { keyPrefix: `test:${randomUUID()}:` });
  const sent: Mail[] = [];
  const auth = await prepareAuth({
    db,
    redis,
    mailer: { send: async (mail) => void sent.push(mail) },
    config: {
      jwtSecret: 'test-secret-test-secret-test-secret-test',
      appUrl: APP_URL,
      apiUrl: 'http://api.test',
      bcryptCost: 4,
      accessTtlSeconds: 900,
      refreshTtlSeconds: 86400,
      verifyTtlMs: 60000,
      resetTtlMs: 60000,
      lockThreshold: 5,
      lockMs: 60000,
      ipFailLimit: 1000,
      routeLimit: 1000,
      routeWindowMs: 60000,
      ...config,
    },
  });
  const { bucket, icons } = await testIconStore();
  const apps = await prepareApps(db, icons);
  // Records queued jobs instead of reaching a worker.
  const jobs: { name: string; data: { buildId: string } }[] = [];
  const queue = { add: async (name: string, data: { buildId: string }) => void jobs.push({ name, data }) };
  const builds = await prepareBuilds({
    db,
    redis,
    queue: queue as never,
    storage: icons,
    config: { dailyLimit: 3, windowMs: 24 * 60 * 60 * 1000, ...buildsConfig },
  });
  const reports = await prepareReports(db, 'abuse@example.com');
  const ring = parseKeyring(`1:${randomBytes(32).toString('base64')}`);
  const keystores = await prepareKeystores(db);
  const downloads = db.collection('keystoreDownloads');
  const pay = await prepareOrders(db);
  const checkouts: CheckoutInput[] = [];
  const refunds: { paymentId: string; amount: number }[] = [];
  const razorpayFake: PaymentProvider = {
    name: 'razorpay',
    createCheckout: async (input) => {
      checkouts.push(input);
      return { providerOrderId: `order_${checkouts.length}`, keyId: 'rzp_test_fake' };
    },
    fetchStatus: async () => ({ status: 'created', amount: 9900, currency: 'INR' }),
    refund: async (paymentId, amount) => {
      refunds.push({ paymentId, amount });
      return { refundId: `rfnd_${refunds.length}` };
    },
    verifyPayment: (providerOrderId, paymentId, signature) => signature === createHmac('sha256', KEY_SECRET).update(`${providerOrderId}|${paymentId}`).digest('hex'),
    verifyWebhook: (rawBody, headers) => verifyRazorpayWebhook(WEBHOOK_SECRET, rawBody, headers),
  };
  const payments = { ...pay, apps: apps.apps, users: db.collection('users'), keystores: keystores as never, builds: builds.builds, mailer: { send: async (mail: Mail) => void sent.push(mail) }, providers: { razorpay: razorpayFake } as Payments['providers'] };
  const admin = await prepareAdmin({ db, auth, adminEmails: [ADMIN_EMAIL] });
  const server: Server = createApp({ checkMongo: async () => {}, checkRedis: async () => {}, auth, fetchUrl, apps, builds, trustProxy, unsafe: unsafeLookup && createUnsafeChecker(redis, unsafeLookup), reports, screenshot, keys: { keystores, downloads, ring }, payments, admin }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const client = () => {
    const cookies = new Map<string, string>();
    const raw: string[] = [];
    const send = async (path: string, init: RequestInit & { csrf?: string | null; headers?: Record<string, string> } = {}) => {
      const { csrf, ...rest } = init;
      const headers: Record<string, string> = { ...rest.headers };
      headers.cookie = [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
      const token = csrf === undefined ? cookies.get('csrf_token') : csrf;
      if (token) headers['x-csrf-token'] = token;
      const response = await fetch(`${url}${path}`, { redirect: 'manual', ...rest, headers });
      for (const header of response.headers.getSetCookie()) {
        raw.push(header);
        const [pair] = header.split(';');
        const [name, value] = pair!.split('=');
        if (value) cookies.set(name!, value);
        else cookies.delete(name!);
      }
      return response;
    };
    return {
      cookies,
      raw,
      get: (path: string, options = {}) => send(path, options),
      post: (path: string, body?: unknown, options: { csrf?: string | null; headers?: Record<string, string> } = {}) =>
        send(path, {
          method: 'POST',
          ...options,
          headers: { 'content-type': 'application/json', ...options.headers },
          body: JSON.stringify(body ?? {}),
        }),
      put: (path: string, body?: unknown, options: { csrf?: string | null } = {}) =>
        send(path, { method: 'PUT', ...options, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) }),
      delete: (path: string, options: { csrf?: string | null } = {}) => send(path, { method: 'DELETE', ...options }),
      upload: (path: string, body: Buffer, type = 'image/png', options: { csrf?: string | null } = {}) =>
        send(path, { method: 'POST', ...options, headers: { 'content-type': type }, body: new Uint8Array(body) }),
    };
  };

  const tokenIn = (mail: Mail) => /token=([\w-]+)/.exec(mail.text)?.[1] ?? '';
  const mailTo = async (to: string) => {
    for (let i = 0; i < 40; i += 1) {
      const mail = sent.findLast((item) => item.to === to);
      if (mail) return mail;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`No mail for ${to}`);
  };

  return {
    admin,
    url, client, sent, mailTo, tokenIn, db, redis,
    users: db.collection('users'),
    apps: apps.apps,
    builds: builds.builds,
    reports: reports.reports,
    keystores,
    downloads,
    orders: pay.orders,
    payments,
    checkouts,
    refunds,
    ring,
    jobs,
    icons,
    bucket,
    sessions: db.collection('sessions'),
    emailTokens: db.collection('emailTokens'),
    close: async () => {
      builds.hub.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await db.dropDatabase();
      await mongo.close();
      redis.disconnect();
    },
  };
};

export const PASSWORD = 'correct-horse-battery';

export const signedIn = async (harness: Awaited<ReturnType<typeof makeHarness>>, email = 'user@example.com') => {
  const user = harness.client();
  await user.post('/auth/register', { email, password: PASSWORD });
  await user.post('/auth/login', { email, password: PASSWORD });
  return user;
};

/** Signs the admin in with a password and, unless told otherwise, the second step too. */
export const adminIn = async (harness: Awaited<ReturnType<typeof makeHarness>>, { twoFactor = true } = {}) => {
  const user = await signedIn(harness, ADMIN_EMAIL);
  const secret = newSecret();
  await harness.users.updateOne({ email: ADMIN_EMAIL }, { $set: { emailVerifiedAt: new Date() } });
  const found = await harness.users.findOne({ email: ADMIN_EMAIL });
  await harness.admin.state.replaceOne({ _id: found!._id }, { _id: found!._id, sealed: seal('test-secret-test-secret-test-secret-test', secret) }, { upsert: true });
  await harness.redis.del(`admin:2fa:${String(found!._id)}`);
  if (twoFactor) expect((await user.post('/admin/api/2fa/verify', { code: codeNow(secret) })).status).toBe(204);
  return { user, secret, id: found!._id };
};
