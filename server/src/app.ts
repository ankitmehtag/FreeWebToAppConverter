import express from 'express';
import helmet from 'helmet';
import { reportsRouter, type Reports } from './abuse/reports';
import type { UnsafeChecker } from './abuse/unsafe';
import type { Apps } from './apps';
import { appsRouter } from './apps/routes';
import type { Builds } from './builds';
import { installRouter } from './builds/install';
import { buildsRouter } from './builds/routes';
import type { Auth } from './auth';
import { authRouter } from './auth/routes';
import { keysRouter, type Keys } from './keystores/routes';
import type { FetchUrl } from './url/fetcher';
import { urlRouter } from './url/routes';
import type { Screenshot } from './url/screenshot';

type Check = () => Promise<void>;

type AppOptions = {
  checkMongo: Check;
  checkRedis: Check;
  checkTimeoutMs?: number;
  auth?: Auth;
  fetchUrl?: FetchUrl;
  screenshot?: Screenshot;
  apps?: Apps;
  builds?: Builds;
  /** Express's `trust proxy` value. Unset, forwarded headers are ignored and `req.ip` is the socket address. */
  trustProxy?: string;
  /** The unsafe-site list. Without it, those checks are skipped. */
  unsafe?: UnsafeChecker;
  reports?: Reports;
  /** Premium signing keys. Off when no master key is set. */
  keys?: Keys;
};

const probe = async (check: Check, timeoutMs: number) => {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timed out')), timeoutMs);
  });
  try {
    await Promise.race([check(), timeout]);
    return 'up';
  } catch {
    return 'down';
  } finally {
    clearTimeout(timer);
  }
};

export const createApp = ({ checkMongo, checkRedis, checkTimeoutMs = 2000, auth, fetchUrl, apps, builds, trustProxy, unsafe, reports, screenshot, keys }: AppOptions) => {
  const app = express();
  app.disable('x-powered-by');
  // Only a named proxy may say who the visitor is, so a forged header can't dodge per-IP limits.
  if (trustProxy) app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);
  app.use(helmet());

  if (auth) app.use('/auth', authRouter(auth));
  if (auth && fetchUrl) app.use('/url', urlRouter(auth, fetchUrl, unsafe, screenshot));
  if (auth && apps) app.use('/apps', appsRouter(auth, apps, fetchUrl, builds, unsafe));
  if (auth && keys) app.use('/keystores', keysRouter(auth, keys));
  if (auth && builds) {
    // Mounted first, because a phone opening an install link has no session.
    app.use('/builds/install', installRouter(auth, builds));
    app.use('/builds', buildsRouter(auth, builds));
    if (reports) app.use('/reports', reportsRouter(auth, builds, reports));
  }

  app.get('/health', async (_req, res) => {
    const [mongo, redis] = await Promise.all([
      probe(checkMongo, checkTimeoutMs),
      probe(checkRedis, checkTimeoutMs),
    ]);
    const healthy = mongo === 'up' && redis === 'up';
    res.status(healthy ? 200 : 503).json({ status: healthy ? 'ok' : 'degraded', mongo, redis });
  });

  return app;
};
