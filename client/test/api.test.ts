import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../src/api';
import { safeNext } from '../src/session';

type Call = { path: string; init: RequestInit };
let calls: Call[];
let answers: Response[];

beforeEach(() => {
  calls = [];
  answers = [];
  document.cookie = 'csrf_token=abc123; path=/';
  vi.stubGlobal('fetch', async (path: string, init: RequestInit) => {
    calls.push({ path, init });
    return answers.shift() ?? new Response('{}', { status: 200 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.cookie = 'csrf_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const headers = (call: Call) => call.init.headers as Record<string, string>;

describe('AC2: the CSRF token', () => {
  it('is copied from its cookie into every state-changing call', async () => {
    await api('/apps', { method: 'POST', body: {} });
    await api('/apps/1', { method: 'PUT', body: {} });
    await api('/apps/1', { method: 'DELETE' });
    expect(calls.map((call) => headers(call)['x-csrf-token'])).toEqual(['abc123', 'abc123', 'abc123']);
  });

  it('is not sent on reads', async () => {
    await api('/apps');
    expect(headers(calls[0]!)['x-csrf-token']).toBeUndefined();
  });

  it('stays same-origin, so cookies go to our API only', async () => {
    await api('/apps');
    expect(calls[0]!.init.credentials).toBe('same-origin');
  });
});

describe('expired access token', () => {
  it('refreshes once and repeats the call', async () => {
    answers = [json({ error: 'Not signed in' }, 401), json({ status: 'ok' }), json([{ id: 'a' }])];
    expect(await api('/apps')).toEqual([{ id: 'a' }]);
    expect(calls.map((call) => call.path)).toEqual(['/apps', '/auth/refresh', '/apps']);
  });

  it('does not refresh after a failed sign-in', async () => {
    answers = [json({ error: 'Invalid email or password' }, 401)];
    await expect(api('/auth/login', { method: 'POST', body: {} })).rejects.toBeInstanceOf(ApiError);
    expect(calls).toHaveLength(1);
  });

  it('passes field errors through', async () => {
    answers = [json({ error: 'Invalid request', fields: { appName: 'Too long' } }, 400)];
    await expect(api('/apps', { method: 'POST', body: {} })).rejects.toMatchObject({ status: 400, fields: { appName: 'Too long' } });
  });
});

describe('return after sign-in', () => {
  it.each([
    ['/my-apps/1/basics', '/my-apps/1/basics'],
    ['//evil.example', '/my-apps'],
    ['/\\evil.example', '/my-apps'],
    ['https://evil.example', '/my-apps'],
    [null, '/my-apps'],
  ])('sends %s to %s', (next, expected) => {
    expect(safeNext(next)).toBe(expected);
  });
});
