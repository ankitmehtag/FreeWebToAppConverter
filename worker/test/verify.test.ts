import { describe, expect, it } from 'vitest';
import { checkBuild } from '../src/verify';

const facts = `package: name='com.sitetoapk.example' versionCode='3' versionName='1.2.3' platformBuildVersionName='15'
Signer #1 certificate SHA-256 digest: c546406a238a4147630aac444c97d0ac505b3c2e944c0fd8f1956e6c23a024e8`;
const expected = {
  packageName: 'com.sitetoapk.example',
  versionCode: 3,
  versionName: '1.2.3',
  signerSha256: 'c546406a238a4147630aac444c97d0ac505b3c2e944c0fd8f1956e6c23a024e8',
};
const MB = 1024 * 1024;

describe('AC10: post-build checks', () => {
  it('accepts a matching APK', () => {
    expect(() => checkBuild(facts, 3 * MB, expected)).not.toThrow();
  });

  it.each([
    ['package', { packageName: 'com.other.app' }],
    ['version code', { versionCode: 4 }],
    ['version name', { versionName: '9.9' }],
    ['signer', { signerSha256: 'ab'.repeat(32) }],
  ])('rejects a wrong %s', (name, change) => {
    expect(() => checkBuild(facts, 3 * MB, { ...expected, ...change })).toThrow(name);
  });

  it('rejects output with no signature', () => {
    expect(() => checkBuild(facts.split('\n')[0]!, 3 * MB, expected)).toThrow('signer');
  });

  it('rejects a suspicious size', () => {
    expect(() => checkBuild(facts, 1000, expected)).toThrow('size');
    expect(() => checkBuild(facts, 500 * MB, expected)).toThrow('size');
  });
});
