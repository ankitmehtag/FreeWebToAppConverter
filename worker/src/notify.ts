import type { Collection } from 'mongodb';
import { buildFailed, buildReady } from '@sitetoapk/shared/mail';
import type { BuildRequest } from './builds';

const RESEND_URL = 'https://api.resend.com/emails';

export type Notifier = (build: BuildRequest, outcome: 'success' | 'failed') => Promise<void>;

type NotifyOptions = { users: Collection; apiKey: string; from: string; appUrl: string };

/** Emails the owner when a build ends. A failed email never fails the build. */
export const createNotifier = ({ users, apiKey, from, appUrl }: NotifyOptions): Notifier => async (build, outcome) => {
  if (!build.ownerId || !build.appId) return;
  try {
    const user = await users.findOne({ _id: build.ownerId as never });
    if (!user?.email || !user.emailVerifiedAt) return;
    const link = `${appUrl}/my-apps/${build.appId}/builds/${build._id}`;
    const ok = outcome === 'success';
    const message = (ok ? buildReady : buildFailed)({ appUrl, appName: build.config.appName, link });
    const response = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from, to: user.email, ...message }),
    });
    if (!response.ok) console.error(`Build email answered ${response.status}`);
  } catch (error) {
    console.error('Build email failed', (error as Error).message);
  }
};

export type Mailer = (to: string, subject: string, text: string, html?: string) => Promise<void>;

/** Sends a plain email through Resend. It throws when Resend refuses, so a caller can try again later. */
export const createMailer = ({ apiKey, from }: { apiKey: string; from: string }): Mailer => async (to, subject, text, html) => {
  const response = await fetch(RESEND_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from, to, subject, text, ...(html ? { html } : {}) }),
  });
  if (!response.ok) throw new Error(`Email answered ${response.status}`);
};
