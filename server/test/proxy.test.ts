import { describe, expect, it } from 'vitest';
import { makeHarness } from './auth-helpers';

const forgot = (h: Awaited<ReturnType<typeof makeHarness>>, ip: string) =>
  h.client().post('/auth/password/forgot', { email: 'someone@example.com' }, { headers: { 'x-forwarded-for': ip } });

describe('F10 AC11: visitor IP', () => {
  it('counts each visitor on its own behind the trusted proxy', async () => {
    const h = await makeHarness({ routeLimit: 2 }, undefined, {}, { trustProxy: 'loopback' });
    const first = [];
    for (let i = 0; i < 3; i += 1) first.push((await forgot(h, '203.0.113.7')).status);
    expect(first).toEqual([202, 202, 429]);
    expect((await forgot(h, '198.51.100.9')).status).toBe(202);
    await h.close();
  });

  it('ignores a forged X-Forwarded-For when no proxy is trusted', async () => {
    const h = await makeHarness({ routeLimit: 2 });
    const statuses = [];
    for (const ip of ['203.0.113.1', '203.0.113.2', '203.0.113.3']) statuses.push((await forgot(h, ip)).status);
    expect(statuses).toEqual([202, 202, 429]);
    await h.close();
  });
});
