import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { ensureFirebaseApp, sendToApp, serviceAccountFromEnv, topicFor } from '../src/firebase';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const account = {
  client_email: 'push@p.iam.gserviceaccount.com',
  project_id: 'p',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
};
const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const googleConfig = Buffer.from(
  JSON.stringify({
    project_info: { project_id: 'p', project_number: '123' },
    client: [{ client_info: { mobilesdk_app_id: '1:123:android:abc' }, api_key: [{ current_key: 'AIza-key' }] }],
  }),
).toString('base64');

describe('Firebase', () => {
  it('reuses an app that is already registered for the package', async () => {
    const calls: string[] = [];
    const fetcher = vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes('oauth2')) return json({ access_token: 't' });
      if (url.endsWith('/config')) return json({ configFileContents: googleConfig });
      return json({ apps: [{ appId: '1:123:android:abc', packageName: 'com.x.app' }] });
    });
    const client = await ensureFirebaseApp(account, 'com.x.app', fetcher as never);
    expect(client).toEqual({ apiKey: 'AIza-key', appId: '1:123:android:abc', projectId: 'p', senderId: '123' });
    expect(calls.some((url) => url.includes('androidApps') && url.includes('1:123:android:abc/config'))).toBe(true);
  });

  it('creates the app when the package is new', async () => {
    const methods: string[] = [];
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('oauth2')) return json({ access_token: 't' });
      methods.push(`${init?.method ?? 'GET'} ${url.split('/').slice(-1)[0]!.split('?')[0]}`);
      if (url.endsWith('/config')) return json({ configFileContents: googleConfig });
      if (init?.method === 'POST') return json({ name: 'operations/1', done: true, response: { appId: '1:123:android:abc', packageName: 'com.x.app' } });
      return json({});
    });
    await ensureFirebaseApp(account, 'com.x.app', fetcher as never);
    expect(methods).toContain('POST androidApps');
  });

  it('sends to the topic of one app, signed in with a bearer token', async () => {
    const fetcher = vi.fn(async (url: string) => (url.includes('oauth2') ? json({ access_token: 'tok' }) : json({})));
    await sendToApp(account, 'a1', { title: 'Hi', body: 'There' }, fetcher as never);
    const [url, init] = fetcher.mock.calls[1] as unknown as [string, { body: string; headers: Record<string, string> }];
    expect(url).toBe('https://fcm.googleapis.com/v1/projects/p/messages:send');
    expect(init.headers.authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body).message).toEqual({ topic: topicFor('a1'), notification: { title: 'Hi', body: 'There' } });
  });

  it('is off without a key, and rejects a key that is not a service account', () => {
    expect(serviceAccountFromEnv({})).toBeUndefined();
    expect(() => serviceAccountFromEnv({ FIREBASE_SERVICE_ACCOUNT_B64: Buffer.from('{}').toString('base64') })).toThrow();
  });
});
