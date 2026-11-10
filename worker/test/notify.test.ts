import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNotifier } from '../src/notify';
import type { BuildRequest } from '../src/builds';

const build = { _id: 'b1', appId: 'a1', ownerId: 'u1', config: { appName: 'Shop <1>' } } as unknown as BuildRequest;
const options = (user: object | null) => ({
  users: { findOne: async () => user } as never,
  apiKey: 'key',
  from: 'App <noreply@example.com>',
  appUrl: 'https://example.com',
});

afterEach(() => vi.unstubAllGlobals());

describe('build email', () => {
  it('sends a verified owner the build link, with the app name escaped', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    await createNotifier(options({ email: 'a@b.co', emailVerifiedAt: new Date() }))(build, 'success');
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body.to).toBe('a@b.co');
    expect(body.text).toContain('https://example.com/my-apps/a1/builds/b1');
    expect(body.html).toContain('Shop &lt;1&gt;');
  });

  it('skips unverified owners and builds without an owner', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await createNotifier(options({ email: 'a@b.co' }))(build, 'failed');
    await createNotifier(options(null))({ ...build, ownerId: undefined } as BuildRequest, 'failed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never throws when the mail service is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(createNotifier(options({ email: 'a@b.co', emailVerifiedAt: new Date() }))(build, 'failed')).resolves.toBeUndefined();
  });
});
