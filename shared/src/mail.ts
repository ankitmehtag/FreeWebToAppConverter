/** Every email the product sends. One function per email returns `{ subject, text, html }`, so the server and the worker share one copy. */
export type Message = { subject: string; text: string; html?: string };

export const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

type Layout = {
  appUrl: string;
  heading: string;
  /** Plain paragraphs. They are escaped here, so callers pass raw text. */
  paragraphs: string[];
  button?: { label: string; url: string };
  /** Why this email was sent, for the footer. */
  why: string;
};

const site = (appUrl: string) => appUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');

/** One plain, single-column layout: no images, no scripts, readable in dark mode. */
const html = ({ appUrl, heading, paragraphs, button, why }: Layout) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<style>@media (prefers-color-scheme: dark){.bg{background:#14181b!important}.card{background:#1d2327!important;color:#eef2f4!important}.muted{color:#9aa7ae!important}}</style></head>
<body class="bg" style="margin:0;padding:24px 12px;background:#f3f6f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<div class="card" style="max-width:520px;margin:0 auto;padding:28px;background:#ffffff;color:#1a1f23;border-radius:12px;line-height:1.55;font-size:16px">
<div style="font-weight:700;color:#0f766e;margin-bottom:16px">${escapeHtml(site(appUrl))}</div>
<h1 style="font-size:20px;margin:0 0 14px">${escapeHtml(heading)}</h1>
${paragraphs.map((p) => `<p style="margin:0 0 14px;white-space:pre-line">${escapeHtml(p)}</p>`).join('\n')}
${button ? `<p style="margin:22px 0"><a href="${escapeHtml(button.url)}" style="display:inline-block;padding:12px 20px;background:#0f766e;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600">${escapeHtml(button.label)}</a></p>
<p class="muted" style="margin:0 0 14px;font-size:13px;color:#5b6870;word-break:break-all">Or paste this link into your browser: ${escapeHtml(button.url)}</p>` : ''}
<hr style="border:none;border-top:1px solid #d5dde1;margin:22px 0 14px">
<p class="muted" style="margin:0;font-size:12px;color:#5b6870">${escapeHtml(why)}</p>
</div></body></html>`;

const message = (subject: string, text: string, layout: Layout): Message => ({ subject, text, html: html(layout) });

export const verifyEmail = ({ appUrl, link }: { appUrl: string; link: string }) =>
  message('Verify your email', `Confirm your email address:\n\n${link}\n\nThis link lasts 24 hours.`, {
    appUrl, heading: 'Confirm your email address', paragraphs: ['Tap the button to confirm this address. The link lasts 24 hours.'],
    button: { label: 'Confirm email', url: link }, why: 'You are getting this because someone signed up with this address. If it was not you, ignore this email.',
  });

export const resetPassword = ({ appUrl, link }: { appUrl: string; link: string }) =>
  message('Reset your password', `Choose a new password:\n\n${link}\n\nThis link lasts 1 hour.`, {
    appUrl, heading: 'Choose a new password', paragraphs: ['Tap the button to set a new password. The link lasts 1 hour.'],
    button: { label: 'Choose a new password', url: link }, why: 'You are getting this because a password reset was asked for this account. If it was not you, ignore this email.',
  });

export const alreadyRegistered = ({ appUrl }: { appUrl: string }) => {
  const text = `Someone tried to sign up with this address, which already has an account. If it was you, sign in or reset your password at ${appUrl}.`;
  return message('You already have an account', text, {
    appUrl, heading: 'You already have an account', paragraphs: ['Someone tried to sign up with this address, which already has an account. If it was you, sign in or reset your password.'],
    button: { label: 'Go to sign in', url: appUrl }, why: 'You are getting this because of a sign-up attempt with this address.',
  });
};

export const passwordChanged = ({ appUrl, at }: { appUrl: string; at: Date }) => {
  const when = at.toUTCString();
  const text = `The password for your account was changed on ${when}.\n\nIf it was you, nothing more to do. If it was not, reset your password now and every other device will be signed out:\n${appUrl}/forgot-password`;
  return message('Your password was changed', text, {
    appUrl, heading: 'Your password was changed', paragraphs: [`The password for your account was changed on ${when}.`, 'If it was you, there is nothing more to do. If it was not, reset your password now.'],
    button: { label: 'Reset your password', url: `${appUrl}/forgot-password` }, why: 'You are getting this because the password of this account changed.',
  });
};

export const accountDisabled = ({ appUrl, contact }: { appUrl: string; contact: string }) => {
  const text = `Your account was disabled and you have been signed out. If you think this is a mistake, write to ${contact}.`;
  return message('Your account was disabled', text, {
    appUrl, heading: 'Your account was disabled', paragraphs: ['Your account was disabled and you have been signed out.', `If you think this is a mistake, write to ${contact}.`],
    why: 'You are getting this because of a change to this account.',
  });
};

const money = (amount: number, currency: string) => (currency === 'INR' ? `₹${amount / 100}` : `$${amount / 100}`);

export type ReceiptFacts = { receiptNo: string; paidAt: Date; buyerEmail: string; appName: string; couponCode?: string | null; listAmount: number; amount: number; currency: string };

/** Plain receipt: no tax line while the seller has no GST registration. */
export const receipt = ({ appUrl, ...r }: ReceiptFacts & { appUrl: string }) => {
  const facts = [
    `Date:     ${new Date(r.paidAt).toISOString().slice(0, 10)}`,
    `Buyer:    ${r.buyerEmail}`,
    `Item:     Premium for ${r.appName}, one time`,
    ...(r.couponCode ? [`Coupon:   ${r.couponCode} (list price ${money(r.listAmount, r.currency)})`] : []),
    `Paid:     ${money(r.amount, r.currency)} (${r.currency})`,
  ];
  const notTax = 'This is a payment receipt, not a tax invoice. No tax was charged.';
  const refunds = 'Refunds: a full refund within 7 days of payment, if the signing key and the app bundle have not been downloaded.';
  return message(`Your receipt ${r.receiptNo}`, [`Receipt ${r.receiptNo}`, '', ...facts, '', notTax, '', refunds, ''].join('\n'), {
    appUrl, heading: `Receipt ${r.receiptNo}`, paragraphs: [facts.join('\n'), notTax, refunds],
    why: 'You are getting this because of a purchase on your account.',
  });
};

export const refunded = ({ appUrl, receiptNo, appName, amount, currency }: { appUrl: string; receiptNo: string; appName: string; amount: number; currency: string }) => {
  const sum = money(amount, currency);
  const text = `Your payment of ${sum} for Premium on ${appName} (receipt ${receiptNo}) was refunded in full.\n\nIt can take a few days to show on your statement. ${appName} is back on the Free plan; builds you already made stay available until they expire.`;
  return message(`Refund for receipt ${receiptNo}`, text, {
    appUrl, heading: 'Your refund is on its way',
    paragraphs: [`Your payment of ${sum} for Premium on ${appName} (receipt ${receiptNo}) was refunded in full.`, `It can take a few days to show on your statement. ${appName} is back on the Free plan; builds you already made stay available until they expire.`],
    why: 'You are getting this because an order on your account was refunded.',
  });
};

export const buildReady = ({ appUrl, appName, link }: { appUrl: string; appName: string; link: string }) =>
  message(`Your app ${appName} is ready`, `Your app ${appName} is ready to download:\n${link}`, {
    appUrl, heading: `Your app ${appName} is ready`, paragraphs: ['Your app is built and ready to download.'],
    button: { label: 'Open the build page', url: link }, why: 'You are getting this because a build of your app finished.',
  });

export const buildFailed = ({ appUrl, appName, link }: { appUrl: string; appName: string; link: string }) =>
  message(`Your app ${appName} could not be built`, `The build for ${appName} failed. See what went wrong:\n${link}`, {
    appUrl, heading: `The build for ${appName} failed`, paragraphs: ['Open the build page to see what went wrong.'],
    button: { label: 'See what went wrong', url: link }, why: 'You are getting this because a build of your app ended with an error.',
  });

export const buildExpiring = ({ appUrl, appName, link, expiresAt }: { appUrl: string; appName: string; link: string; expiresAt: Date }) => {
  const day = expiresAt.toDateString();
  return message(`Your ${appName} build is deleted soon`, `The Free build of ${appName} is deleted on ${day} and you have not downloaded it yet. Download it now:\n${link}\n\nAfter that you can build the app again.`, {
    appUrl, heading: `Download ${appName} before ${day}`, paragraphs: [`The Free build of ${appName} is deleted on ${day} and you have not downloaded it yet.`, 'After that you can build the app again.'],
    button: { label: 'Download the app', url: link }, why: 'You are getting this once, because a build of yours has not been downloaded.',
  });
};

export const keyReminder = ({ appUrl, appName, link }: { appUrl: string; appName: string; link: string }) =>
  message(`Back up the signing key for ${appName}`, `The Premium signing key for ${appName} has not been downloaded yet.\n\nGoogle Play only accepts updates signed with this key. If we lose it, or you lose access, you cannot update the app. Download it once and keep it somewhere safe:\n${link}`, {
    appUrl, heading: `Back up the signing key for ${appName}`,
    paragraphs: [`The Premium signing key for ${appName} has not been downloaded yet.`, 'Google Play only accepts updates signed with this key. If we lose it, or you lose access, you cannot update the app. Download it once and keep it somewhere safe.'],
    button: { label: 'Download the key', url: link }, why: 'You are getting this because the signing key of your Premium app has not been downloaded.',
  });

export const keyErasing = ({ appUrl, appName, link, eraseOn }: { appUrl: string; appName: string; link: string; eraseOn: Date }) => {
  const day = eraseOn.toDateString();
  return message(`The signing key for ${appName} will be erased on ${day}`, `The signing key for ${appName} will be erased on ${day}. Until then you can still download it:\n${link}\n\nAfter that day it cannot be brought back.`, {
    appUrl, heading: `The signing key for ${appName} will be erased on ${day}`, paragraphs: ['Until then you can still download it. After that day it cannot be brought back.'],
    button: { label: 'Download the key', url: link }, why: 'You are getting this because the signing key of your app is scheduled for erasure.',
  });
};

/** Text only on purpose: nothing a reporter writes can change how the owner reads it. */
export const abuseReport = (r: { reason: string; appName: string; appId: string; packageName: string; site: string; buildId: string; reporterEmail?: string | null; details?: string | null }): Message => ({
  subject: `App report: ${r.reason}, ${r.appName}`,
  text: [`Reason: ${r.reason}`, `App: ${r.appName} (${r.appId})`, `Package: ${r.packageName}`, `Site: ${r.site}`, `Build: ${r.buildId}`, `Reporter email: ${r.reporterEmail ?? 'not given'}`, '', r.details ?? 'No details given.'].join('\n'),
});
