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

  it('uses the reseller\'s brand for a reseller\'s build, escaped, with the built-with line when the plan has it', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const resellers = { findOne: async () => ({ brandName: 'Pixel <Agency>', accent: '#ff5500', terms: { builtWithLine: true } }) } as never;
    await createNotifier({ ...options({ email: 'a@b.co', emailVerifiedAt: new Date() }), resellers })({ ...build, resellerId: 'r1' } as unknown as BuildRequest, 'success');
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body.html).toContain('Pixel &lt;Agency&gt;');
    expect(body.html).toContain('background:#ff5500');
    expect(body.html).toContain('Built with example.com.');
    expect(body.html).not.toContain('>example.com</div>');
  });

  it('ignores a colour that is not plain hex, and drops the built-with line when the plan removes it', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const resellers = { findOne: async () => ({ brandName: 'Agency', accent: 'red;x:y', terms: { builtWithLine: false } }) } as never;
    await createNotifier({ ...options({ email: 'a@b.co', emailVerifiedAt: new Date() }), resellers })({ ...build, resellerId: 'r1' } as unknown as BuildRequest, 'failed');
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body.html).toContain('background:#0f766e');
    expect(body.html).not.toContain('red;x:y');
    expect(body.html).not.toContain('Built with');
  });
});
