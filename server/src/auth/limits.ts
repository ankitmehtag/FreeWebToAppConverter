import type { NextFunction, Request, Response } from 'express';
import type { Auth } from './index';

const countInWindow = async ({ redis }: Auth, key: string, windowMs: number) => {
  const count = await redis.incr(key);
  if (count === 1) await redis.pexpire(key, windowMs);
  return count;
};

export const limitRoute = (auth: Auth, name: string) => async (req: Request, res: Response, next: NextFunction) => {
  const count = await countInWindow(auth, `rate:${name}:${req.ip}`, auth.config.routeWindowMs);
  if (count > auth.config.routeLimit) res.status(429).json({ error: 'Too many requests' });
  else next();
};

export const isIpBlocked = async ({ redis, config }: Auth, ip: string) =>
  Number(await redis.get(`fail:ip:${ip}`)) >= config.ipFailLimit;

export const isLocked = async ({ redis }: Auth, email: string) => (await redis.exists(`lock:${email}`)) === 1;

/** Counts a failure. A locked account stops counting, so its lock always runs out. */
export const recordFailure = async (auth: Auth, email: string, ip: string) => {
  const { lockMs, lockThreshold } = auth.config;
  await countInWindow(auth, `fail:ip:${ip}`, lockMs);
  if ((await countInWindow(auth, `fail:${email}`, lockMs)) >= lockThreshold) {
    await auth.redis.set(`lock:${email}`, '1', 'PX', lockMs);
    await auth.redis.del(`fail:${email}`);
  }
};

export const clearFailures = async ({ redis }: Auth, email: string) => {
  await redis.del(`fail:${email}`, `lock:${email}`);
};
