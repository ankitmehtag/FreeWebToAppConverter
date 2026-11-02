import type { ObjectId } from 'mongodb';
import type { Auth } from './index';
import { randomToken, sha256 } from './tokens';

type Kind = 'verify' | 'reset';

const createLink = async (auth: Auth, userId: ObjectId, kind: Kind) => {
  const token = randomToken();
  const ttl = kind === 'verify' ? auth.config.verifyTtlMs : auth.config.resetTtlMs;
  await auth.emailTokens.insertOne({ hash: sha256(token), userId, kind, expiresAt: new Date(Date.now() + ttl) });
  return `${auth.config.appUrl}/${kind === 'verify' ? 'verify-email' : 'reset-password'}?token=${token}`;
};

/** Spends a link once. The delete is the check, so that two uses can't both succeed. */
export const consumeLink = async (auth: Auth, token: string, kind: Kind) => {
  const link = await auth.emailTokens.findOneAndDelete({ hash: sha256(token), kind, expiresAt: { $gt: new Date() } });
  return (link?.userId as ObjectId | undefined) ?? null;
};

// Not awaited by the routes, because how long mail takes would reveal whether an account exists.
const dispatch = (auth: Auth, send: () => Promise<void>) => {
  send().catch(() => console.error('Sending mail failed'));
};

export const sendVerification = (auth: Auth, userId: ObjectId, to: string) =>
  dispatch(auth, async () => {
    const link = await createLink(auth, userId, 'verify');
    await auth.mailer.send({ to, subject: 'Verify your email', text: `Confirm your email address:\n\n${link}\n\nThis link lasts 24 hours.` });
  });

export const sendReset = (auth: Auth, userId: ObjectId, to: string) =>
  dispatch(auth, async () => {
    const link = await createLink(auth, userId, 'reset');
    await auth.mailer.send({ to, subject: 'Reset your password', text: `Choose a new password:\n\n${link}\n\nThis link lasts 1 hour.` });
  });

export const sendAlreadyRegistered = (auth: Auth, to: string) =>
  dispatch(auth, () =>
    auth.mailer.send({
      to,
      subject: 'You already have an account',
      text: `Someone tried to sign up with this address, which already has an account. If it was you, sign in or reset your password at ${auth.config.appUrl}.`,
    }),
  );
