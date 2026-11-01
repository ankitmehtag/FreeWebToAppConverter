import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { artifactKey } from '../src/storage';
import { tempFile } from './helpers';
import { testStorage } from './storage-helpers';

const apk = Buffer.alloc(200 * 1024, 9);
const sha = createHash('sha256').update(apk).digest('hex');

describe('AC3: keys', () => {
  it('uses only the plan and build id', () => {
    expect(artifactKey('free', 'abc')).toBe('free/abc.apk');
  });
});

describe('storage', () => {
  it('uploads with fixed headers and reports the size', async () => {
    const storage = await testStorage();
    const key = artifactKey('free', randomUUID());
    expect(await storage.put(key, tempFile('a.apk', apk))).toBe(apk.length);
    const response = await fetch(await storage.signedLink(key, 60));
    expect(createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex')).toBe(sha);
    expect(response.headers.get('content-type')).toBe('application/vnd.android.package-archive');
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="app.apk"');
  });
});

describe('AC6: access', () => {
  it('refuses anything but a valid signature', async () => {
    const storage = await testStorage();
    const key = artifactKey('free', randomUUID());
    await storage.put(key, tempFile('a.apk', apk));
    const link = new URL(await storage.signedLink(key, 60));

    expect((await fetch(`${link.origin}${link.pathname}`)).status).toBe(403);
    const edited = new URL(link);
    edited.searchParams.set('X-Amz-Signature', '0'.repeat(64));
    expect((await fetch(edited)).status).toBe(403);
    const other = new URL(link);
    other.pathname = other.pathname.replace('.apk', 'x.apk');
    expect((await fetch(other)).status).toBe(403);
  });
});

describe('delete', () => {
  it('stops an existing link', async () => {
    const storage = await testStorage();
    const key = artifactKey('free', randomUUID());
    await storage.put(key, tempFile('a.apk', apk));
    const link = await storage.signedLink(key, 60);
    await storage.remove(key);
    expect((await fetch(link)).status).toBe(404);
  });
});

describe('AC10: lifecycle', () => {
  it('expires Free artifacts after 7 days', async () => {
    const storage = await testStorage();
    await storage.applyLifecycle();
    expect(await storage.readLifecycle()).toEqual([{ prefix: 'free/', days: 7, enabled: true }]);
  });
});
