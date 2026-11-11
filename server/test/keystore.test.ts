import { randomBytes } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKeystoreOnce, parseKeyring, prepareKeystores, readKeystore } from '@sitetoapk/shared/keystore';
import { makeHarness } from './auth-helpers';

type Harness = Awaited<ReturnType<typeof makeHarness>>;
let h: Harness;
beforeAll(async () => { h = await makeHarness(); });
afterAll(() => h.close());

const ring = parseKeyring(`1:${randomBytes(32).toString('base64')}`);
const secrets = (marker: string) => ({
  alias: `alias-${marker}`,
  storePassword: `store-pass-${marker}`,
  keyPassword: `key-pass-${marker}`,
  keystore: Buffer.from(`JKS-BYTES-${marker}`),
});
const prints = { sha1: 'AA:BB', sha256: 'CC:DD' };

describe('AC4: the keystores collection', () => {
  it('stores a keystore that can be read back only through the master key', async () => {
    const keystores = await prepareKeystores(h.db);
    const appId = new ObjectId();
    expect(await createKeystoreOnce(keystores, ring, appId, secrets('one'), prints)).toBe(true);

    const raw = JSON.stringify(await keystores.findOne({ appId }));
    for (const plain of ['alias-one', 'store-pass-one', 'key-pass-one', 'JKS-BYTES-one']) {
      expect(raw).not.toContain(plain);
      expect(raw).not.toContain(Buffer.from(plain).toString('base64'));
    }

    const read = await readKeystore(keystores, ring, appId);
    expect(read?.secrets.storePassword).toBe('store-pass-one');
    expect(read?.secrets.keystore.toString()).toBe('JKS-BYTES-one');
    expect(read?.sha256).toBe('CC:DD');
    expect(await readKeystore(keystores, parseKeyring(`1:${randomBytes(32).toString('base64')}`), appId).catch(() => 'refused')).toBe('refused');
  });

  it('keeps one keystore per app: a second create changes nothing', async () => {
    const keystores = await prepareKeystores(h.db);
    const appId = new ObjectId();
    expect(await createKeystoreOnce(keystores, ring, appId, secrets('first'), prints)).toBe(true);
    expect(await createKeystoreOnce(keystores, ring, appId, secrets('second'), prints)).toBe(false);
    expect(await keystores.countDocuments({ appId })).toBe(1);
    expect((await readKeystore(keystores, ring, appId))?.secrets.alias).toBe('alias-first');
  });

  it('ends with exactly one keystore when creates run at the same moment', async () => {
    const keystores = await prepareKeystores(h.db);
    const appId = new ObjectId();
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => createKeystoreOnce(keystores, ring, appId, secrets(String(i)), prints)),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await keystores.countDocuments({ appId })).toBe(1);
  });

  it('answers null for an app with no keystore', async () => {
    const keystores = await prepareKeystores(h.db);
    expect(await readKeystore(keystores, ring, new ObjectId())).toBeNull();
  });
});
