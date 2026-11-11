import type { Collection } from 'mongodb';
import type { BuildRequest } from './builds';

const RESEND_URL = 'https://api.resend.com/emails';

export type Notifier = (build: BuildRequest, outcome: 'success' | 'failed') => Promise<void>;

type NotifyOptions = { users: Collection; apiKey: string; from: string; appUrl: string };

const escape = (text: string) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Emails the owner when a build ends. A failed email never fails the build. */
export const createNotifier = ({ users, apiKey, from, appUrl }: NotifyOptions): Notifier => async (build, outcome) => {
  if (!build.ownerId || !build.appId) return;
  try {
    const user = await users.findOne({ _id: build.ownerId as never });
    if (!user?.email || !user.emailVerifiedAt) return;
    const link = `${appUrl}/my-apps/${build.appId}/builds/${build._id}`;
    const name = escape(build.config.appName);
    const ok = outcome === 'success';
    const response = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from,
        to: user.email,
        subject: ok ? `Your app ${build.config.appName} is ready` : `Your app ${build.config.appName} could not be built`,
        text: ok
          ? `Your app ${build.config.appName} is ready to download:\n${link}`
          : `The build for ${build.config.appName} failed. See what went wrong:\n${link}`,
        html: ok
          ? `<p>Your app <b>${name}</b> is ready to download.</p><p><a href="${link}">Open the build page</a></p>`
          : `<p>The build for <b>${name}</b> failed.</p><p><a href="${link}">See what went wrong</a></p>`,
      }),
    });
    if (!response.ok) console.error(`Build email answered ${response.status}`);
  } catch (error) {
    console.error('Build email failed', (error as Error).message);
  }
};

export type Mailer = (to: string, subject: string, text: string) => Promise<void>;

/** Sends a plain email through Resend. It throws when Resend refuses, so a caller can try again later. */
export const createMailer = ({ apiKey, from }: { apiKey: string; from: string }): Mailer => async (to, subject, text) => {
  const response = await fetch(RESEND_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from, to, subject, text }),
  });
  if (!response.ok) throw new Error(`Email answered ${response.status}`);
};
