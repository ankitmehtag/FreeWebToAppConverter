import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { makeHarness, PASSWORD, signedIn } from './auth-helpers';

type Harness = Awaited<ReturnType<typeof makeHarness>>;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let h: Harness;
beforeAll(async () => { h = await makeHarness(); });
afterAll(() => h.close());
const email = () => `u${Math.random().toString(36).slice(2)}@example.com`;

describe('AC1: register and sign in', () => {
  it('creates a working session and stores a bcrypt hash', async () => {
    const strict = await makeHarness({ bcryptCost: 12 });
    const user = await signedIn(strict, 'a@example.com');
    const me = await user.get('/auth/me');
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({ email: 'a@example.com', emailVerified: false });
    const stored = await strict.users.findOne({ email: 'a@example.com' });
    expect(stored?.passwordHash).toMatch(/^\$2[aby]\$12\$/);
    await strict.close();
  });

  it('refuses a wrong password', async () => {
    const address = email();
    await signedIn(h, address);
    expect((await h.client().post('/auth/login', { email: address, password: 'wrong-password-1' })).status).toBe(401);
  });
});

describe('AC2: normalised, unique emails', () => {
  it('keeps one account for two spellings', async () => {
    const c = h.client();
    await c.post('/auth/register', { email: 'Mixed@Example.com', password: PASSWORD });
    await c.post('/auth/register', { email: 'mixed@example.com', password: PASSWORD });
    expect(await h.users.countDocuments({ email: 'mixed@example.com' })).toBe(1);
  });

  it('survives two registrations at once', async () => {
    const address = email();
    await Promise.all(Array.from({ length: 5 }, () => h.client().post('/auth/register', { email: address, password: PASSWORD })));
    expect(await h.users.countDocuments({ email: address })).toBe(1);
  });

  it('rejects a 9 character password', async () => {
    expect((await h.client().post('/auth/register', { email: email(), password: '123456789' })).status).toBe(400);
  });
});

describe('AC3: no account discovery', () => {
  it('answers sign-in the same way', async () => {
    const address = email();
    await signedIn(h, address);
    const known = await h.client().post('/auth/login', { email: address, password: 'wrong-password-1' });
    const unknown = await h.client().post('/auth/login', { email: email(), password: 'wrong-password-1' });
    expect(known.status).toBe(unknown.status);
    expect(await known.text()).toBe(await unknown.text());
  });

  it('answers register the same way, and warns the owner', async () => {
    const address = email();
    const first = await h.client().post('/auth/register', { email: address, password: PASSWORD });
    const second = await h.client().post('/auth/register', { email: address, password: PASSWORD });
    expect(second.status).toBe(first.status);
    expect(await second.text()).toBe(await first.text());
    await vi.waitFor(() => expect(h.sent.filter((mail) => mail.to === address)).toHaveLength(2));
    expect(h.sent.filter((mail) => mail.to === address).at(-1)?.subject).toContain('already');
  });

  it('answers reset the same way', async () => {
    const address = email();
    await signedIn(h, address);
    const known = await h.client().post('/auth/password/forgot', { email: address });
    const unknown = await h.client().post('/auth/password/forgot', { email: email() });
    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(await known.text()).toBe(await unknown.text());
  });

  it('takes about the same time for known and unknown emails', async () => {
    const timed = await makeHarness({ bcryptCost: 10 });
    const address = 'timing@example.com';
    await signedIn(timed, address);
    const sample = async (target: string) => {
      const start = performance.now();
      await timed.client().post('/auth/login', { email: target, password: 'wrong-password-1' });
      return performance.now() - start;
    };
    const known: number[] = [];
    const unknown: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      known.push(await sample(address));
      unknown.push(await sample(`nobody${i}@example.com`));
    }
    const median = (values: number[]) => values.sort((a, b) => a - b)[2]!;
    expect(Math.abs(median(known) - median(unknown))).toBeLessThan(median(known) * 0.35);
    await timed.close();
  });
});

describe('AC4: cookies', () => {
  it('sets both tokens HttpOnly, Secure and SameSite=Lax', async () => {
    const user = await signedIn(h, email());
    for (const name of ['access_token', 'refresh_token']) {
      const cookie = user.raw.find((value) => value.startsWith(`${name}=`));
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/Secure/i);
      expect(cookie).toMatch(/SameSite=Lax/i);
    }
  });
});

describe('AC5: refresh', () => {
  it('issues a new pair once the access token expires, and refuses when both have', async () => {
    const short = await makeHarness({ accessTtlSeconds: 1, refreshTtlSeconds: 3 });
    const user = await signedIn(short);
    await sleep(1600);
    expect((await user.get('/auth/me')).status).toBe(401);
    const before = user.cookies.get('refresh_token');
    expect((await user.post('/auth/refresh')).status).toBe(200);
    expect(user.cookies.get('refresh_token')).not.toBe(before);
    expect((await user.get('/auth/me')).status).toBe(200);
    await sleep(3200);
    expect((await user.get('/auth/me')).status).toBe(401);
    expect((await user.post('/auth/refresh')).status).toBe(401);
    await short.close();
  });
});

describe('AC6: reuse detection', () => {
  it('revokes the family and stores no raw token', async () => {
    const user = await signedIn(h, email());
    const stolen = user.cookies.get('refresh_token')!;
    const csrf = user.cookies.get('csrf_token')!;
    await user.post('/auth/refresh');
    const thief = h.client();
    thief.cookies.set('refresh_token', stolen);
    expect((await thief.post('/auth/refresh', {}, { csrf })).status).toBe(401);
    expect((await user.get('/auth/me')).status).toBe(401);
    expect((await user.post('/auth/refresh')).status).toBe(401);
    const secret = stolen.split('.')[1]!;
    expect(JSON.stringify(await h.sessions.find().toArray())).not.toContain(secret);
  });
});

describe('AC7: revocation', () => {
  it('sign-out stops the old cookies', async () => {
    const user = await signedIn(h, email());
    const access = user.cookies.get('access_token')!;
    const refresh = user.cookies.get('refresh_token')!;
    const csrf = user.cookies.get('csrf_token')!;
    expect((await user.post('/auth/logout')).status).toBe(204);
    const old = h.client();
    old.cookies.set('access_token', access);
    old.cookies.set('refresh_token', refresh);
    expect((await old.get('/auth/me')).status).toBe(401);
    expect((await old.post('/auth/refresh', {}, { csrf })).status).toBe(401);
  });

  it('a reset ends every session', async () => {
    const address = email();
    const first = await signedIn(h, address);
    const second = h.client();
    await second.post('/auth/login', { email: address, password: PASSWORD });
    await h.client().post('/auth/password/forgot', { email: address });
    await vi.waitFor(() => expect(h.sent.filter((m) => m.to === address && m.subject.includes('Reset'))).toHaveLength(1));
    const token = h.tokenIn(await h.mailTo(address));
    expect((await h.client().post('/auth/password/reset', { token, password: 'a-brand-new-password' })).status).toBe(204);
    expect((await first.get('/auth/me')).status).toBe(401);
    expect((await second.get('/auth/me')).status).toBe(401);
    expect((await h.client().post('/auth/login', { email: address, password: 'a-brand-new-password' })).status).toBe(200);
    expect((await h.client().post('/auth/login', { email: address, password: PASSWORD })).status).toBe(401);
  });
});

describe('AC8: CSRF', () => {
  it.each(['/auth/logout', '/auth/refresh', '/auth/email/resend'])('refuses %s without a valid token', async (path) => {
    const user = await signedIn(h, email());
    expect((await user.post(path, {}, { csrf: null })).status).toBe(403);
    expect((await user.post(path, {}, { csrf: 'wrong' })).status).toBe(403);
    expect((await user.get('/auth/me')).status).toBe(200);
  });

  it("refuses another session's token", async () => {
    const first = await signedIn(h, email());
    const second = await signedIn(h, email());
    expect((await first.post('/auth/logout', {}, { csrf: second.cookies.get('csrf_token')! })).status).toBe(403);
  });
});

describe('AC9: email links', () => {
  it('verifies once, and stores no raw token', async () => {
    const address = email();
    const user = await signedIn(h, address);
    const token = h.tokenIn(await h.mailTo(address));
    expect(JSON.stringify(await h.emailTokens.find().toArray())).not.toContain(token);
    expect((await h.client().post('/auth/email/verify', { token })).status).toBe(204);
    expect((await user.get('/auth/me').then((r) => r.json())).emailVerified).toBe(true);
    expect((await h.client().post('/auth/email/verify', { token })).status).toBe(400);
  });

  it('a reset link works once', async () => {
    const address = email();
    await signedIn(h, address);
    await h.client().post('/auth/password/forgot', { email: address });
    await vi.waitFor(() => expect(h.sent.filter((m) => m.to === address)).toHaveLength(2));
    const token = h.tokenIn(await h.mailTo(address));
    expect((await h.client().post('/auth/password/reset', { token, password: 'another-long-password' })).status).toBe(204);
    expect((await h.client().post('/auth/password/reset', { token, password: 'yet-another-password' })).status).toBe(400);
  });

  it('refuses expired links and wrong kinds', async () => {
    const short = await makeHarness({ verifyTtlMs: 1, resetTtlMs: 1 });
    await short.client().post('/auth/register', { email: 'x@example.com', password: PASSWORD });
    const verify = short.tokenIn(await short.mailTo('x@example.com'));
    await sleep(10);
    expect((await short.client().post('/auth/email/verify', { token: verify })).status).toBe(400);
    await short.close();

    const address = email();
    await h.client().post('/auth/register', { email: address, password: PASSWORD });
    const live = h.tokenIn(await h.mailTo(address));
    expect((await h.client().post('/auth/password/reset', { token: live, password: 'a-brand-new-password' })).status).toBe(400);
  });
});

describe('AC11: lockout', () => {
  it('refuses the right password while locked, and lifts by itself', async () => {
    const locked = await makeHarness({ lockMs: 700 });
    const address = 'lock@example.com';
    await signedIn(locked, address);
    for (let i = 0; i < 5; i += 1) await locked.client().post('/auth/login', { email: address, password: 'wrong-password-1' });
    expect((await locked.client().post('/auth/login', { email: address, password: PASSWORD })).status).toBe(401);
    await sleep(900);
    expect((await locked.client().post('/auth/login', { email: address, password: PASSWORD })).status).toBe(200);
    await locked.close();
  });

  it('does not extend the lock while someone keeps trying', async () => {
    const locked = await makeHarness({ lockMs: 700 });
    const address = 'hold@example.com';
    await signedIn(locked, address);
    for (let i = 0; i < 5; i += 1) await locked.client().post('/auth/login', { email: address, password: 'wrong-password-1' });
    const end = Date.now() + 800;
    while (Date.now() < end) {
      await locked.client().post('/auth/login', { email: address, password: 'wrong-password-1' });
      await sleep(60);
    }
    await sleep(150);
    expect((await locked.client().post('/auth/login', { email: address, password: PASSWORD })).status).toBe(200);
    await locked.close();
  });

  it('limits failures per IP across many emails', async () => {
    const limited = await makeHarness({ ipFailLimit: 3 });
    const results: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      results.push((await limited.client().post('/auth/login', { email: `n${i}@example.com`, password: 'wrong-password-1' })).status);
    }
    expect(results.at(-1)).toBe(429);
    await limited.close();
  });
});

describe('AC12: lockout hides accounts, and can be escaped', () => {
  it('treats an unknown email the same', async () => {
    const address = email();
    await signedIn(h, address);
    const unknown = email();
    const attempt = (target: string, password = 'wrong-password-1') => h.client().post('/auth/login', { email: target, password });
    const known: string[] = [];
    const missing: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      known.push(`${(await attempt(address)).status}`);
      missing.push(`${(await attempt(unknown)).status}`);
    }
    expect(known).toEqual(missing);
  });

  it('a reset link recovers a locked account', async () => {
    const address = email();
    await signedIn(h, address);
    for (let i = 0; i < 5; i += 1) await h.client().post('/auth/login', { email: address, password: 'wrong-password-1' });
    await h.client().post('/auth/password/forgot', { email: address });
    await vi.waitFor(() => expect(h.sent.filter((m) => m.to === address && m.subject.includes('Reset'))).toHaveLength(1));
    const token = h.tokenIn(await h.mailTo(address));
    await h.client().post('/auth/password/reset', { token, password: 'a-brand-new-password' });
    expect((await h.client().post('/auth/login', { email: address, password: 'a-brand-new-password' })).status).toBe(200);
  });
});

describe('AC13: route limits', () => {
  it.each([
    ['/auth/register', { email: 'r@example.com', password: PASSWORD }],
    ['/auth/password/forgot', { email: 'r@example.com' }],
  ])('limits %s', async (path, body) => {
    const limited = await makeHarness({ routeLimit: 2 });
    const statuses: number[] = [];
    for (let i = 0; i < 4; i += 1) statuses.push((await limited.client().post(path, body)).status);
    expect(statuses.slice(-1)).toEqual([429]);
    await limited.close();
  });

  it('limits resend', async () => {
    const limited = await makeHarness({ routeLimit: 2 });
    const user = await signedIn(limited);
    const statuses: number[] = [];
    for (let i = 0; i < 4; i += 1) statuses.push((await user.post('/auth/email/resend')).status);
    expect(statuses.slice(-1)).toEqual([429]);
    await limited.close();
  });
});

describe('AC16: hardening', () => {
  it('refuses extra fields', async () => {
    const response = await h.client().post('/auth/login', { email: email(), password: PASSWORD, role: 'admin' });
    expect(response.status).toBe(400);
  });

  it('refuses an operator in place of a string', async () => {
    expect((await h.client().post('/auth/login', { email: { $ne: null }, password: PASSWORD })).status).toBe(400);
  });

  it('refuses an unknown origin and allows the app', async () => {
    const bad = await h.client().post('/auth/login', { email: email(), password: PASSWORD }, { headers: { origin: 'http://evil.test' } });
    expect(bad.status).toBe(403);
    const good = await h.client().post('/auth/login', { email: email(), password: PASSWORD }, { headers: { origin: 'http://app.test' } });
    expect(good.status).toBe(401);
    expect(good.headers.get('access-control-allow-origin')).toBe('http://app.test');
    expect(good.headers.get('access-control-allow-credentials')).toBe('true');
  });

  it('sets security headers', async () => {
    const response = await h.client().get('/auth/me');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-powered-by')).toBeNull();
  });

  describe('logs', () => {
    afterEach(() => vi.restoreAllMocks());
    it('hold no password or token', async () => {
      const lines: string[] = [];
      for (const method of ['log', 'error', 'warn', 'info'] as const) {
        vi.spyOn(console, method).mockImplementation((...args) => void lines.push(args.join(' ')));
      }
      const address = email();
      const user = await signedIn(h, address);
      await user.post('/auth/refresh');
      await h.client().post('/auth/login', { email: address, password: 'wrong-password-1' });
      await h.client().post('/auth/login', { email: 'not-an-email', password: PASSWORD });
      const output = lines.join('\n');
      expect(output).not.toContain(PASSWORD);
      expect(output).not.toContain(user.cookies.get('refresh_token')!.split('.')[1]);
    });

    it('keeps responses free of hashes', async () => {
      const user = await signedIn(h, email());
      expect(await (await user.get('/auth/me')).text()).not.toContain('$2');
    });
  });
});
