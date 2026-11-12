import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { createRemoteJWKSet, jwtVerify, SignJWT } from 'jose';
import type { ObjectId } from 'mongodb';
import type { Auth } from './index';
import { revokeAllSessions, startSession } from './session';
import { randomToken, safeEqual } from './tokens';
import type { GoogleConfig } from './types';

const FLOW_COOKIE = 'google_flow';
const FLOW_MS = 10 * 60 * 1000;

const key = ({ config }: Auth) => new TextEncoder().encode(config.jwtSecret);
const redirectUri = ({ config }: Auth) => `${config.apiUrl}/auth/google/callback`;

export const startGoogle = async (auth: Auth, google: GoogleConfig, res: Response) => {
  const state = randomToken();
  const verifier = randomToken();
  const nonce = randomToken();
  const flow = await new SignJWT({ state, verifier, nonce })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('10m')
    .sign(key(auth));
  res.cookie(FLOW_COOKIE, flow, { httpOnly: true, secure: true, sameSite: 'lax', path: '/auth/google', maxAge: FLOW_MS });

  const target = new URL(google.authUrl);
  target.search = new URLSearchParams({
    client_id: google.clientId,
    redirect_uri: redirectUri(auth),
    response_type: 'code',
    scope: 'openid email',
    state,
    nonce,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  }).toString();
  res.redirect(target.toString());
};

const readClaims = async (auth: Auth, google: GoogleConfig, req: Request) => {
  const { payload: flow } = await jwtVerify(String(req.cookies?.[FLOW_COOKIE] ?? ''), key(auth), { algorithms: ['HS256'] });
  if (!safeEqual(String(req.query.state ?? ''), String(flow.state))) throw new Error('Wrong state');

  const response = await fetch(google.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: String(req.query.code ?? ''),
      client_id: google.clientId,
      client_secret: google.clientSecret,
      redirect_uri: redirectUri(auth),
      code_verifier: String(flow.verifier),
    }),
  });
  if (!response.ok) throw new Error('Token exchange failed');
  const { id_token: idToken } = (await response.json()) as { id_token: string };

  const { payload } = await jwtVerify(idToken, createRemoteJWKSet(new URL(google.jwksUrl)), {
    issuer: google.issuer,
    audience: google.clientId,
  });
  if (payload.nonce !== flow.nonce) throw new Error('Wrong nonce');
  if (payload.email_verified !== true || typeof payload.email !== 'string' || !payload.sub) {
    throw new Error('Email not verified by Google');
  }
  return { sub: payload.sub, email: payload.email.toLowerCase() };
};

const findOrLinkUser = async (auth: Auth, { sub, email }: { sub: string; email: string }): Promise<ObjectId> => {
  const known = await auth.users.findOne({ googleSub: sub });
  if (known) return known._id;

  const existing = await auth.users.findOne({ email });
  if (!existing) {
    const { insertedId } = await auth.users.insertOne({ email, googleSub: sub, emailVerifiedAt: new Date(), createdAt: new Date() });
    return insertedId;
  }

  if (existing.emailVerifiedAt) {
    await auth.users.updateOne({ _id: existing._id }, { $set: { googleSub: sub } });
    return existing._id;
  }

  // Nobody proved they owned this address, so whoever set the password may be a stranger.
  await auth.users.updateOne(
    { _id: existing._id },
    { $set: { googleSub: sub, emailVerifiedAt: new Date() }, $unset: { passwordHash: '' } },
  );
  await revokeAllSessions(auth, existing._id);
  return existing._id;
};

export const finishGoogle = async (auth: Auth, google: GoogleConfig, req: Request, res: Response) => {
  res.clearCookie(FLOW_COOKIE, { path: '/auth/google' });
  try {
    const userId = await findOrLinkUser(auth, await readClaims(auth, google, req));
    if ((await auth.users.findOne({ _id: userId }))?.disabledAt) throw new Error('Account disabled');
    await startSession(auth, res, userId);
    res.redirect(auth.config.appUrl);
  } catch {
    res.status(400).json({ error: 'Google sign-in failed' });
  }
};
