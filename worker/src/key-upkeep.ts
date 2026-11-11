import type { Collection } from 'mongodb';
import { eraseDue, type Keystores } from '@sitetoapk/shared/keystore';
import type { Mailer } from './notify';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Days after the key is made when the two backup reminders go out. */
const REMINDER_DAYS = [1, 7];

type Deps = { keystores: Keystores; users: Collection; apps: Collection; mail: Mailer; appUrl: string; now?: Date };

const ownerEmail = async (users: Collection, ownerId: unknown) => {
  const user = await users.findOne({ _id: ownerId as never });
  return user?.email && user.emailVerifiedAt ? (user.email as string) : null;
};

const appName = async (apps: Collection, appId: unknown) => ((await apps.findOne({ _id: appId as never }))?.draft?.appName as string | undefined) ?? 'your app';

/**
 * Reminds owners who have not downloaded their key, one day and seven days after it was made, tells owners
 * whose key is about to be erased, and erases the keys whose wait is over. Safe to run often: each step is
 * claimed in the database before it is sent, so two runs never send the same email twice.
 */
export const keyUpkeep = async ({ keystores, users, apps, mail, appUrl, now = new Date() }: Deps) => {
  let reminders = 0;
  let notices = 0;

  for (const key of await keystores.find({ downloadedAt: null, deleteAfter: null, remindersSent: { $lt: REMINDER_DAYS.length } }).toArray()) {
    const due = REMINDER_DAYS[key.remindersSent]!;
    if (now.getTime() - key.createdAt.getTime() < due * DAY_MS || !key.ownerId) continue;
    const claimed = await keystores.updateOne({ _id: key._id, remindersSent: key.remindersSent }, { $inc: { remindersSent: 1 } });
    if (claimed.modifiedCount !== 1) continue;
    try {
      const to = await ownerEmail(users, key.ownerId);
      if (!to) continue;
      const name = await appName(apps, key.appId);
      await mail(
        to,
        `Back up the signing key for ${name}`,
        `The Premium signing key for ${name} has not been downloaded yet.\n\nGoogle Play only accepts updates signed with this key. If we lose it, or you lose access, you cannot update the app. Download it once and keep it somewhere safe:\n${appUrl}/my-apps/${key.appId}/review`,
      );
      reminders += 1;
    } catch (error) {
      console.error('Key reminder failed', (error as Error).message);
      await keystores.updateOne({ _id: key._id }, { $inc: { remindersSent: -1 } });
    }
  }

  for (const key of await keystores.find({ deleteAfter: { $ne: null }, eraseNoticeSent: { $ne: true } }).toArray()) {
    const claimed = await keystores.updateOne({ _id: key._id, eraseNoticeSent: { $ne: true } }, { $set: { eraseNoticeSent: true } });
    if (claimed.modifiedCount !== 1) continue;
    try {
      const to = key.ownerId ? await ownerEmail(users, key.ownerId) : null;
      if (!to) continue;
      const name = await appName(apps, key.appId);
      await mail(
        to,
        `The signing key for ${name} will be erased on ${key.deleteAfter!.toDateString()}`,
        `The signing key for ${name} will be erased on ${key.deleteAfter!.toDateString()}. Until then you can still download it:\n${appUrl}/my-apps/${key.appId}/review\n\nAfter that day it cannot be brought back.`,
      );
      notices += 1;
    } catch (error) {
      console.error('Key erase notice failed', (error as Error).message);
      await keystores.updateOne({ _id: key._id }, { $set: { eraseNoticeSent: false } });
    }
  }

  const erased = await eraseDue(keystores, now);
  return { reminders, notices, erased };
};
