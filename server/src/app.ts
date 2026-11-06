import express from 'express';
import helmet from 'helmet';
import type { Apps } from './apps';
import { appsRouter } from './apps/routes';
import type { Builds } from './builds';
import { installRouter } from './builds/install';
import { buildsRouter } from './builds/routes';
import type { Auth } from './auth';
import { authRouter } from './auth/routes';
import type { FetchUrl } from './url/fetcher';
import { urlRouter } from './url/routes';

type Check = () => Promise<void>;

type AppOptions = {
  checkMongo: Check;
  checkRedis: Check;
  checkTimeoutMs?: number;
  auth?: Auth;
  fetchUrl?: FetchUrl;
  apps?: Apps;
  builds?: Builds;
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

export const createApp = ({ checkMongo, checkRedis, checkTimeoutMs = 2000, auth, fetchUrl, apps, builds }: AppOptions) => {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());

  if (auth) app.use('/auth', authRouter(auth));
  if (auth && fetchUrl) app.use('/url', urlRouter(auth, fetchUrl));
  if (auth && apps) app.use('/apps', appsRouter(auth, apps, fetchUrl, builds));
  if (auth && builds) {
    // Mounted first, because a phone opening an install link has no session.
    app.use('/builds/install', installRouter(auth, builds));
    app.use('/builds', buildsRouter(auth, builds));
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
