import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { jwtVerify, SignJWT } from 'jose';
import type { ObjectId } from 'mongodb';
import type { Auth } from './index';
import { hmac, randomToken, safeEqual, sha256 } from './tokens';

const ACCESS_COOKIE = 'access_token';
const REFRESH_COOKIE = 'refresh_token';
const CSRF_COOKIE = 'csrf_token';

const key = ({ config }: Auth) => new TextEncoder().encode(config.jwtSecret);
const csrfFor = ({ config }: Auth, sessionId: string) => hmac(config.jwtSecret, `csrf:${sessionId}`);

const baseCookie = { secure: true, sameSite: 'lax' } as const;

const setCookies = async (auth: Auth, res: Response, sessionId: string, refresh: string, refreshExpires: Date) => {
  const { accessTtlSeconds } = auth.config;
  const access = await new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(`${accessTtlSeconds}s`)
    .sign(key(auth));
  res.cookie(ACCESS_COOKIE, access, { ...baseCookie, httpOnly: true, path: '/', maxAge: accessTtlSeconds * 1000 });
  res.cookie(REFRESH_COOKIE, refresh, { ...baseCookie, httpOnly: true, path: '/auth', expires: refreshExpires });
  // Readable on purpose: the app copies it into a header, which another site can't do.
  res.cookie(CSRF_COOKIE, csrfFor(auth, sessionId), { ...baseCookie, path: '/', expires: refreshExpires });
};

const clearCookies = (res: Response) => {
  res.clearCookie(ACCESS_COOKIE, { path: '/' });
  res.clearCookie(REFRESH_COOKIE, { path: '/auth' });
  res.clearCookie(CSRF_COOKIE, { path: '/' });
};

export const startSession = async (auth: Auth, res: Response, userId: ObjectId) => {
  const sessionId = randomUUID();
  const refresh = `${sessionId}.${randomToken()}`;
  const expiresAt = new Date(Date.now() + auth.config.refreshTtlSeconds * 1000);
  await auth.sessions.insertOne({ _id: sessionId as never, userId, currentHash: sha256(refresh), expiresAt, revokedAt: null });
  await setCookies(auth, res, sessionId, refresh, expiresAt);
};

const revoke = (auth: Auth, sessionId: string) =>
  auth.sessions.updateOne({ _id: sessionId as never }, { $set: { revokedAt: new Date() } });

export const revokeAllSessions = (auth: Auth, userId: ObjectId) =>
  auth.sessions.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date() } });

const liveSession = async (auth: Auth, sessionId: string) => {
  const session = await auth.sessions.findOne({ _id: sessionId as never });
  return session && !session.revokedAt && session.expiresAt > new Date() ? session : null;
};

const refreshSessionId = (req: Request) => {
  const token: unknown = req.cookies?.[REFRESH_COOKIE];
  return typeof token === 'string' ? token.split('.')[0] : undefined;
};

const checkCsrf = (auth: Auth, req: Request, sessionId: string) => {
  const sent = req.get('x-csrf-token');
  return Boolean(sent) && safeEqual(sent!, csrfFor(auth, sessionId));
};

/** Reads the session on every request, so that sign-out takes effect at once. */
export const requireSession = (auth: Auth) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { payload } = await jwtVerify(String(req.cookies?.[ACCESS_COOKIE] ?? ''), key(auth), { algorithms: ['HS256'] });
    const session = await liveSession(auth, String(payload.sid));
    if (session) {
      res.locals.session = session;
      next();
      return;
    }
  } catch {
    // Falls through to the same answer as a revoked session.
  }
  res.status(401).json({ error: 'Not signed in' });
};

export const requireCsrf = (auth: Auth) => (req: Request, res: Response, next: NextFunction) => {
  if (checkCsrf(auth, req, String(res.locals.session._id))) next();
  else res.status(403).json({ error: 'Invalid CSRF token' });
};

export const refreshSession = async (auth: Auth, req: Request, res: Response) => {
  const token = String(req.cookies?.[REFRESH_COOKIE] ?? '');
  const sessionId = refreshSessionId(req) ?? '';
  const hash = sha256(token);
  if (!checkCsrf(auth, req, sessionId)) return res.status(403).json({ error: 'Invalid CSRF token' });

  const session = await liveSession(auth, sessionId);
  if (!session) return res.status(401).json({ error: 'Not signed in' });

  const next = `${sessionId}.${randomToken()}`;
  // Conditional on the current hash, so that two uses of one token can't both win.
  const rotated = await auth.sessions.findOneAndUpdate(
    { _id: sessionId as never, currentHash: hash, revokedAt: null },
    { $set: { currentHash: sha256(next) } },
  );
  if (!rotated) {
    await revoke(auth, sessionId);
    return res.status(401).json({ error: 'Not signed in' });
  }
  await setCookies(auth, res, sessionId, next, session.expiresAt);
  return res.status(200).json({ status: 'ok' });
};

export const endSession = async (auth: Auth, res: Response) => {
  await revoke(auth, String(res.locals.session._id));
  clearCookies(res);
  res.status(204).end();
};
