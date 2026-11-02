import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { makeHarness, PASSWORD, signedIn } from './auth-helpers';

const { publicKey, privateKey } = await generateKeyPair('RS256');
const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };

let issuer = '';
let claims: Record<string, unknown> = {};
let lastChallenge = '';
let lastNonce = '';
let lastVerifier: string | null = '';

const google: Server = createServer((req, res) => {
  const url = new URL(req.url!, issuer);
  if (url.pathname === '/certs') return void res.end(JSON.stringify({ keys: [jwk] }));
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', async () => {
    const form = new URLSearchParams(body);
    lastVerifier = form.get('code_verifier');
    const challenge = createHash('sha256').update(lastVerifier ?? '').digest('base64url');
    if (challenge !== lastChallenge) {
      res.statusCode = 400;
      return void res.end('{"error":"invalid_grant"}');
    }
    const idToken = await new SignJWT({ nonce: lastNonce, ...claims })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(issuer)
      .setAudience(String(claims.aud ?? 'client-id'))
      .setExpirationTime('5m')
      .sign(privateKey);
    res.end(JSON.stringify({ id_token: idToken, access_token: 'x' }));
  });
});

let h: Awaited<ReturnType<typeof makeHarness>>;

beforeAll(async () => {
  google.listen(0);
  await new Promise((resolve) => google.once('listening', resolve));
  issuer = `http://127.0.0.1:${(google.address() as AddressInfo).port}`;
  h = await makeHarness({
    google: {
      clientId: 'client-id',
      clientSecret: 'client-secret',
      authUrl: `${issuer}/auth`,
      tokenUrl: `${issuer}/token`,
      jwksUrl: `${issuer}/certs`,
      issuer,
    },
  });
});
afterAll(async () => {
  await h.close();
  google.close();
});
beforeEach(() => h.users.deleteMany({}));

const begin = async (user: ReturnType<typeof h.client>) => {
  const start = await user.get('/auth/google');
  expect(start.status).toBe(302);
  const target = new URL(start.headers.get('location')!);
  lastChallenge = target.searchParams.get('code_challenge') ?? '';
  lastNonce = target.searchParams.get('nonce') ?? '';
  return target;
};

const finish = async (user: ReturnType<typeof h.client>) => {
  const target = await begin(user);
  return user.get(`/auth/google/callback?code=abc&state=${target.searchParams.get('state')}`);
};

describe('AC14: the flow', () => {
  it('uses state and an S256 PKCE challenge', async () => {
    const target = await begin(h.client());
    expect(target.searchParams.get('code_challenge_method')).toBe('S256');
    expect(target.searchParams.get('state')).toBeTruthy();
    expect(target.searchParams.get('code_challenge')).toBeTruthy();
    expect(target.searchParams.get('nonce')).toBeTruthy();
  });

  it('creates a session from a valid flow', async () => {
    claims = { sub: 'g1', email: 'new@example.com', email_verified: true };
    const user = h.client();
    const done = await finish(user);
    expect(done.status).toBe(302);
    expect(done.headers.get('location')).toContain('http://app.test');
    expect(await (await user.get('/auth/me')).json()).toEqual({ email: 'new@example.com', emailVerified: true });
  });

  it('refuses a wrong state', async () => {
    const user = h.client();
    await begin(user);
    expect((await user.get('/auth/google/callback?code=abc&state=forged')).status).toBe(400);
    expect((await user.get('/auth/me')).status).toBe(401);
  });

  it('refuses a callback with no flow started', async () => {
    expect((await h.client().get('/auth/google/callback?code=abc&state=x')).status).toBe(400);
  });

  it('refuses when the PKCE verifier does not match', async () => {
    const user = h.client();
    const target = await begin(user);
    lastChallenge = 'something-else';
    expect((await user.get(`/auth/google/callback?code=abc&state=${target.searchParams.get('state')}`)).status).toBe(400);
  });

  it('refuses a wrong nonce and a forged audience', async () => {
    const user = h.client();
    const target = await begin(user);
    claims = { sub: 'g1', email: 'n@example.com', email_verified: true, nonce: 'forged' };
    expect((await user.get(`/auth/google/callback?code=abc&state=${target.searchParams.get('state')}`)).status).toBe(400);
    claims = { sub: 'g1', email: 'n@example.com', email_verified: true, aud: 'other-client' };
    const second = h.client();
    expect((await finish(second)).status).toBe(400);
  });
});

describe('AC15: linking', () => {
  it('attaches to a verified password account, keeping one account and its password', async () => {
    await signedIn(h, 'both@example.com');
    await h.users.updateOne({ email: 'both@example.com' }, { $set: { emailVerifiedAt: new Date() } });
    claims = { sub: 'g2', email: 'both@example.com', email_verified: true };
    await finish(h.client());
    expect(await h.users.countDocuments({ email: 'both@example.com' })).toBe(1);
    expect((await h.client().post('/auth/login', { email: 'both@example.com', password: PASSWORD })).status).toBe(200);
  });

  it('does not attach an unverified Google email', async () => {
    await signedIn(h, 'soft@example.com');
    claims = { sub: 'g3', email: 'soft@example.com', email_verified: false };
    const user = h.client();
    expect((await finish(user)).status).toBe(400);
    expect((await h.users.findOne({ email: 'soft@example.com' }))?.googleSub).toBeUndefined();
    expect((await user.get('/auth/me')).status).toBe(401);
  });

  it('returns to the same account on a second sign-in', async () => {
    claims = { sub: 'g4', email: 'again@example.com', email_verified: true };
    await finish(h.client());
    await finish(h.client());
    expect(await h.users.countDocuments({ googleSub: 'g4' })).toBe(1);
  });
});

describe('AC17: a stranger registered the address first', () => {
  it('removes the old password and sessions', async () => {
    const stranger = await signedIn(h, 'taken@example.com');
    claims = { sub: 'g5', email: 'taken@example.com', email_verified: true };
    await finish(h.client());
    expect((await stranger.get('/auth/me')).status).toBe(401);
    expect((await h.client().post('/auth/login', { email: 'taken@example.com', password: PASSWORD })).status).toBe(401);
  });
});
