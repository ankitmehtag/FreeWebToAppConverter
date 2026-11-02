import express from 'express';
import helmet from 'helmet';
import type { Auth } from './auth';
import { authRouter } from './auth/routes';

type Check = () => Promise<void>;

type AppOptions = {
  checkMongo: Check;
  checkRedis: Check;
  checkTimeoutMs?: number;
  auth?: Auth;
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

export const createApp = ({ checkMongo, checkRedis, checkTimeoutMs = 2000, auth }: AppOptions) => {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());

  if (auth) app.use('/auth', authRouter(auth));

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
