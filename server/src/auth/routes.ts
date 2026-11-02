import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import express, { Router, type ErrorRequestHandler, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { consumeLink, sendAlreadyRegistered, sendReset, sendVerification } from './email';
import { finishGoogle, startGoogle } from './google';
import type { Auth } from './index';
import { clearFailures, isIpBlocked, isLocked, limitRoute, recordFailure } from './limits';
import { endSession, refreshSession, requireCsrf, requireSession, revokeAllSessions, startSession } from './session';

const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(10).max(128);
const token = z.string().min(1).max(200);

const credentials = z.strictObject({ email, password });
// Sign-in doesn't apply the length rules, so that a bad password can't be told from a wrong one.
const login = z.strictObject({ email, password: z.string().min(1).max(128) });
const forgot = z.strictObject({ email });
const reset = z.strictObject({ token, password });
const verify = z.strictObject({ token });

const DUPLICATE_KEY = 11000;

const allowOrigin = ({ config }: Auth) => (req: Request, res: Response, next: NextFunction) => {
  const origin = req.get('origin');
  if (origin && origin !== config.appUrl) {
    res.status(403).json({ error: 'Origin not allowed' });
    return;
  }
  res.set('Access-Control-Allow-Origin', config.appUrl);
  res.set('Access-Control-Allow-Credentials', 'true');
  res.set('Access-Control-Allow-Headers', 'content-type, x-csrf-token');
  res.set('Access-Control-Allow-Methods', 'GET, POST');
  res.vary('Origin');
  if (req.method === 'OPTIONS') res.status(204).end();
  else next();
};

const invalid: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof z.ZodError || (error as { type?: string }).type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Invalid request' });
    return;
  }
  console.error('Auth request failed');
  res.status(500).json({ error: 'Something went wrong' });
};

export const authRouter = (auth: Auth) => {
  const router = Router();
  const session = requireSession(auth);
  const csrf = requireCsrf(auth);

  router.use(allowOrigin(auth), cookieParser(), express.json({ limit: '10kb' }));

  router.post('/register', limitRoute(auth, 'register'), async (req, res) => {
    const body = credentials.parse(req.body);
    // Hashed either way, so that a taken address takes just as long.
    const passwordHash = await bcrypt.hash(body.password, auth.config.bcryptCost);
    try {
      const { insertedId } = await auth.users.insertOne({ email: body.email, passwordHash, createdAt: new Date() });
      sendVerification(auth, insertedId, body.email);
    } catch (error) {
      if ((error as { code?: number }).code !== DUPLICATE_KEY) throw error;
      sendAlreadyRegistered(auth, body.email);
    }
    res.status(202).json({ status: 'ok' });
  });

  router.post('/login', async (req, res) => {
    const body = login.parse(req.body);
    const ip = req.ip ?? '';
    if (await isIpBlocked(auth, ip)) {
      res.status(429).json({ error: 'Too many requests' });
      return;
    }

    const locked = await isLocked(auth, body.email);
    const user = await auth.users.findOne({ email: body.email });
    const matches = await bcrypt.compare(body.password, user?.passwordHash ?? auth.dummyHash);
    if (!user?.passwordHash || !matches || locked) {
      if (!locked) await recordFailure(auth, body.email, ip);
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    await clearFailures(auth, body.email);
    await startSession(auth, res, user._id);
    res.status(200).json({ status: 'ok' });
  });

  router.post('/refresh', (req, res) => refreshSession(auth, req, res));

  router.post('/logout', session, csrf, (_req, res) => endSession(auth, res));

  router.get('/me', session, async (_req, res) => {
    const user = await auth.users.findOne({ _id: res.locals.session.userId });
    res.json({ email: user?.email, emailVerified: Boolean(user?.emailVerifiedAt) });
  });

  router.post('/email/verify', async (req, res) => {
    const userId = await consumeLink(auth, verify.parse(req.body).token, 'verify');
    if (!userId) {
      res.status(400).json({ error: 'Invalid or expired link' });
      return;
    }
    await auth.users.updateOne({ _id: userId }, { $set: { emailVerifiedAt: new Date() } });
    res.status(204).end();
  });

  router.post('/email/resend', session, csrf, limitRoute(auth, 'resend'), async (_req, res) => {
    const user = await auth.users.findOne({ _id: res.locals.session.userId });
    if (user && !user.emailVerifiedAt) sendVerification(auth, user._id, user.email);
    res.status(202).json({ status: 'ok' });
  });

  router.post('/password/forgot', limitRoute(auth, 'forgot'), async (req, res) => {
    const body = forgot.parse(req.body);
    const user = await auth.users.findOne({ email: body.email });
    if (user) sendReset(auth, user._id, body.email);
    res.status(202).json({ status: 'ok' });
  });

  router.post('/password/reset', async (req, res) => {
    const body = reset.parse(req.body);
    const userId = await consumeLink(auth, body.token, 'reset');
    if (!userId) {
      res.status(400).json({ error: 'Invalid or expired link' });
      return;
    }
    const passwordHash = await bcrypt.hash(body.password, auth.config.bcryptCost);
    const user = await auth.users.findOneAndUpdate({ _id: userId }, { $set: { passwordHash, emailVerifiedAt: new Date() } });
    await revokeAllSessions(auth, userId);
    if (user) await clearFailures(auth, user.email);
    res.status(204).end();
  });

  const google = auth.config.google;
  if (google) {
    router.get('/google', (_req, res) => startGoogle(auth, google, res));
    router.get('/google/callback', (req, res) => finishGoogle(auth, google, req, res));
  }

  router.use(invalid);
  return router;
};
