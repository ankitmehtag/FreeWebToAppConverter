import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { open, parseKeyring, seal } from '../src/keystore';

const keyText = (id: string) => `${id}:${randomBytes(32).toString('base64')}`;
const secret = Buffer.from('keystore-bytes and password hunter2-hunter2');
const APP = '65f1a2b3c4d5e6f708192a3b';

describe('AC4: keystore secrets are sealed with AES-256-GCM', () => {
  it('opens what it sealed, and the sealed bytes do not contain the secret', () => {
    const ring = parseKeyring(keyText('1'));
    const sealed = seal(ring, secret, APP);
    expect(open(ring, sealed, APP).equals(secret)).toBe(true);
    expect(sealed.data.includes(Buffer.from('hunter2'))).toBe(false);
    expect(sealed.keyId).toBe('1');
    expect(sealed.iv).toHaveLength(12);
    expect(sealed.tag).toHaveLength(16);
  });

  it('uses a new IV every time', () => {
    const ring = parseKeyring(keyText('1'));
    expect(seal(ring, secret, APP).iv.equals(seal(ring, secret, APP).iv)).toBe(false);
  });

  it('cannot be opened with another master key', () => {
    const sealed = seal(parseKeyring(keyText('1')), secret, APP);
    expect(() => open(parseKeyring(keyText('1')), sealed, APP)).toThrow();
  });

  it('refuses a record that was changed', () => {
    const ring = parseKeyring(keyText('1'));
    const sealed = seal(ring, secret, APP);
    sealed.data[0] = sealed.data[0]! ^ 1;
    expect(() => open(ring, sealed, APP)).toThrow();
  });

  it('refuses a record moved to another app', () => {
    const ring = parseKeyring(keyText('1'));
    expect(() => open(ring, seal(ring, secret, APP), '65f1a2b3c4d5e6f708192a3c')).toThrow();
  });
});

describe('key rotation by key id', () => {
  it('seals with the first key and still opens records sealed with an older one', () => {
    const old = keyText('1');
    const fresh = keyText('2');
    const oldRecord = seal(parseKeyring(old), secret, APP);
    const ring = parseKeyring(`${fresh},${old}`);
    expect(seal(ring, secret, APP).keyId).toBe('2');
    expect(open(ring, oldRecord, APP).equals(secret)).toBe(true);
  });

  it('refuses a record whose key id is not in the ring', () => {
    const sealed = seal(parseKeyring(keyText('1')), secret, APP);
    expect(() => open(parseKeyring(keyText('2')), sealed, APP)).toThrow(/key/i);
  });
});

describe('parseKeyring', () => {
  it('rejects a missing, malformed, short or repeated key', () => {
    expect(() => parseKeyring(undefined)).toThrow();
    expect(() => parseKeyring('')).toThrow();
    expect(() => parseKeyring('nocolon')).toThrow();
    expect(() => parseKeyring(`1:${randomBytes(16).toString('base64')}`)).toThrow(/32 bytes/);
    const same = keyText('1');
    expect(() => parseKeyring(`${same},${same}`)).toThrow(/twice/);
  });
});

import { plainHex } from '../src/keystore';
describe('plainHex', () => {
  it('drops the colons and lowercases', () => expect(plainHex('AA:0B:CC')).toBe('aa0bcc'));
});
