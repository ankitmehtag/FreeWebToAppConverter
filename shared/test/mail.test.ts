import { describe, expect, it } from 'vitest';
import * as mail from '../src/mail';

const appUrl = 'https://site.test';
const link = 'https://site.test/go?token=abc123';
const at = new Date('2026-11-13T10:00:00Z');

const all = (): [string, mail.Message][] => [
  ['verifyEmail', mail.verifyEmail({ appUrl, link })],
  ['resetPassword', mail.resetPassword({ appUrl, link })],
  ['alreadyRegistered', mail.alreadyRegistered({ appUrl })],
  ['passwordChanged', mail.passwordChanged({ appUrl, at })],
  ['accountDisabled', mail.accountDisabled({ appUrl, contact: 'help@site.test' })],
  ['receipt', mail.receipt({ appUrl, receiptNo: 'R-000001', paidAt: at, buyerEmail: 'a@b.test', appName: 'Shop', listAmount: 9900, amount: 9900, currency: 'INR' })],
  ['refunded', mail.refunded({ appUrl, receiptNo: 'R-000001', appName: 'Shop', amount: 9900, currency: 'INR' })],
  ['buildReady', mail.buildReady({ appUrl, appName: 'Shop', link })],
  ['buildFailed', mail.buildFailed({ appUrl, appName: 'Shop', link })],
  ['buildExpiring', mail.buildExpiring({ appUrl, appName: 'Shop', link, expiresAt: at })],
  ['keyReminder', mail.keyReminder({ appUrl, appName: 'Shop', link })],
  ['keyErasing', mail.keyErasing({ appUrl, appName: 'Shop', link, eraseOn: at })],
];

describe('AC2: every template has a text and an HTML part', () => {
  it.each(all())('%s', (_name, message) => {
    expect(message.subject.length).toBeGreaterThan(0);
    expect(message.text.length).toBeGreaterThan(0);
    expect(message.html?.length).toBeGreaterThan(0);
    expect(message.html).not.toMatch(/<img|<script|<iframe|https?:\/\/[^"' <]*\.(png|jpe?g|gif)/i);
    const buttons = message.html!.match(/<a href="/g) ?? [];
    expect(buttons.length).toBeLessThanOrEqual(1);
    for (const [, url] of message.html!.matchAll(/<a href="([^"]+)"/g)) expect(message.text.replace(/&amp;/g, '&')).toContain(url!.replace(/&amp;/g, '&'));
  });

  it('the report is text only on purpose', () => {
    const report = mail.abuseReport({ reason: 'phishing', appName: 'Shop', appId: '1', packageName: 'com.x', site: 'https://x.test', buildId: 'b', reporterEmail: null, details: '<b>hi</b>' });
    expect(report.html).toBeUndefined();
    expect(report.text).toContain('<b>hi</b>');
  });
});

describe('AC1: the wording people already get is kept', () => {
  it('subjects and the link text match what was sent before', () => {
    expect(mail.verifyEmail({ appUrl, link })).toMatchObject({ subject: 'Verify your email', text: `Confirm your email address:\n\n${link}\n\nThis link lasts 24 hours.` });
    expect(mail.resetPassword({ appUrl, link })).toMatchObject({ subject: 'Reset your password', text: `Choose a new password:\n\n${link}\n\nThis link lasts 1 hour.` });
    expect(mail.alreadyRegistered({ appUrl })).toMatchObject({ subject: 'You already have an account' });
    expect(mail.buildReady({ appUrl, appName: 'Shop', link })).toMatchObject({ subject: 'Your app Shop is ready', text: `Your app Shop is ready to download:\n${link}` });
    expect(mail.buildFailed({ appUrl, appName: 'Shop', link })).toMatchObject({ subject: 'Your app Shop could not be built', text: `The build for Shop failed. See what went wrong:\n${link}` });
  });
  it('the receipt body is unchanged', () => {
    const { text, subject } = mail.receipt({ appUrl, receiptNo: 'R-000007', paidAt: at, buyerEmail: 'a@b.test', appName: 'Shop', couponCode: 'SAVE', listAmount: 9900, amount: 4950, currency: 'INR' });
    expect(subject).toBe('Your receipt R-000007');
    expect(text).toBe([
      'Receipt R-000007', '', 'Date:     2026-11-13', 'Buyer:    a@b.test', 'Item:     Premium for Shop, one time', 'Coupon:   SAVE (list price ₹99)', 'Paid:     ₹49.5 (INR)', '',
      'This is a payment receipt, not a tax invoice. No tax was charged.', '',
      'Refunds: a full refund within 7 days of payment, if the signing key and the app bundle have not been downloaded.', '',
    ].join('\n'));
  });
});

describe('AC9: user text is escaped in HTML and kept as typed in text', () => {
  it('handles a hostile app name', () => {
    const name = '<script>x</script>';
    for (const message of [mail.buildReady({ appUrl, appName: name, link }), mail.refunded({ appUrl, receiptNo: 'R', appName: name, amount: 100, currency: 'INR' }), mail.keyReminder({ appUrl, appName: name, link }), mail.buildExpiring({ appUrl, appName: name, link, expiresAt: at })]) {
      expect(message.html).not.toContain('<script>');
      expect(message.html).toContain('&lt;script&gt;');
      expect(message.text).toContain(name);
    }
  });
  it('escapes a link that holds quotes', () => {
    const message = mail.verifyEmail({ appUrl, link: 'https://x.test/?a="b"&c=1' });
    expect(message.html).not.toContain('"b"');
    expect(message.html).toContain('&quot;b&quot;');
  });
});
