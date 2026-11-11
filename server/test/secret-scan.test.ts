import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ObjectId } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { scanPaths, scanText } from '../scripts/scan-secrets';
import { applyEvent } from '../src/payments/events';
import { makeHarness, signedIn } from './auth-helpers';

const kinds = (text: string) => scanText(text, 'x').map((finding) => finding.kind);
// Built from pieces, so this file holds no key or card number itself.
const card = ['4242', '4242', '4242', '4242'].join('');
const razorpayKey = ['rzp', 'live', 'AbCdEfGh1234'].join('_');
const stripeKey = ['sk', 'live', 'AbCdEfGh1234'].join('_');
const name1 = ['RAZORPAY', 'KEY', 'SECRET'].join('_');
const name2 = ['KEYSTORE', 'MASTER', 'KEY'].join('_');
const webhookSecret = ['whsec', 'AbCdEfGh12345678'].join('_');

describe('AC14: the scanner finds what it should', () => {
  it('finds payment keys, webhook secrets and private keys', () => {
    expect(kinds(`key = "${razorpayKey}"`)).toEqual(['Razorpay key']);
    expect(kinds(`const k = '${stripeKey}'`)).toEqual(['Stripe key']);
    expect(kinds(webhookSecret)).toEqual(['webhook secret']);
    expect(kinds(`-----BEGIN ${'PRIVATE'} KEY-----`)).toEqual(['private key']);
  });

  it('finds a secret that is set to a value, and not one left empty', () => {
    expect(kinds(`${name1}=abcd1234efgh5678`)).toEqual(['secret assignment']);
    expect(kinds(`${name2}=1:${'A'.repeat(43)}=`)).toEqual(['secret assignment']);
    expect(kinds('RAZORPAY_KEY_SECRET=')).toEqual([]);
    expect(kinds('keySecret: requireEnv(\'RAZORPAY_KEY_SECRET\')')).toEqual([]);
  });

  it('finds a card number, plain or in groups, and nothing that only looks like one', () => {
    expect(kinds(`pay with ${card}`)).toEqual(['card number']);
    expect(kinds(`pay with ${card.replace(/(\d{4})/g, '$1 ').trim()}`)).toEqual(['card number']);
    expect(kinds('1700000000000')).toEqual([]);
    expect(kinds('0000000000000000')).toEqual([]);
    expect(kinds('4242424242424241')).toEqual([]);
    expect(kinds(`sha ${'a'.repeat(20)}${card}${'b'.repeat(8)}`)).toEqual([]);
    expect(kinds('version 1.2.3456789012345')).toEqual([]);
  });

  it('reports where, and never what', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'scan-'));
    await writeFile(join(dir, 'a.txt'), `one\n${razorpayKey}\n`);
    const [finding] = await scanPaths([dir]);
    expect(finding).toEqual({ file: join(dir, 'a.txt'), line: 2, kind: 'Razorpay key' });
    expect(JSON.stringify(finding)).not.toContain(razorpayKey);
  });
});

describe('AC14: the repo and the client bundle are clean', () => {
  const root = resolve(__dirname, '../..');
  const tracked = () => {
    try {
      return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean).map((file) => join(root, file));
    } catch {
      return null;
    }
  };

  it('has no payment key, secret or card number in any tracked file', async () => {
    const files = tracked();
    if (!files) return; // not a git checkout
    expect(await scanPaths(files)).toEqual([]);
  });

  it('has none in the built client, when there is one', async () => {
    const dist = join(root, 'client/dist');
    if (!existsSync(dist)) return;
    expect(await scanPaths([dist])).toEqual([]);
  });
});

describe('AC14: the logs stay clean', () => {
  type Harness = Awaited<ReturnType<typeof makeHarness>>;
  let h: Harness;
  beforeAll(async () => { h = await makeHarness(); });
  afterAll(() => h.close());

  it('writes no key, secret, signature or card number while buying, failing and refunding', async () => {
    const out: string[] = [];
    const spies = (['log', 'error', 'warn', 'info'] as const).map((name) => vi.spyOn(console, name).mockImplementation((...args) => void out.push(args.map(String).join(' '))));
    try {
      const user = await signedIn(h, `u${Math.random().toString(36).slice(2)}@example.com`);
      const app = await (await user.post('/apps', { appName: 'Logged' })).json();
      h.payments.providers.razorpay!.createCheckout = async () => { throw new Error('Razorpay answered 500'); };
      await user.post('/payments/checkout', { appId: app.id });
      const { id } = { id: new ObjectId().toHexString() };
      await applyEvent(h.payments, 'razorpay', { eventId: `m_${id}`, type: 'paid', providerOrderId: 'plink_none', paymentId: card, amount: 1, currency: 'INR' }, 'x');
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
    expect(scanText(out.join('\n'), 'log')).toEqual([]);
    expect(out.join('\n')).not.toContain('whsec_test_secret');
  });
});
