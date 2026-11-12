import type { Collection } from 'mongodb';
import { buildExpiring } from '@sitetoapk/shared/mail';
import type { Mailer } from './notify';

const DAY_MS = 24 * 60 * 60 * 1000;

type Deps = { builds: Collection; users: Collection; mail: Mailer; appUrl: string; now?: Date };

/**
 * Warns owners one day before a Free build's files are deleted, once per build, and only when the build is the app's
 * latest and was never downloaded. Each build is claimed in the database before its email goes out, so two runs or two
 * workers never send it twice; a failed send gives the claim back for the next run.
 */
export const buildExpiryReminders = async ({ builds, users, mail, appUrl, now = new Date() }: Deps) => {
  let sent = 0;
  const due = builds.find({
    status: 'success',
    plan: { $ne: 'premium' },
    artifactKey: { $exists: true },
    apkDownloadedAt: { $exists: false },
    expiryReminderSent: { $ne: true },
    expiresAt: { $gt: now, $lte: new Date(now.getTime() + DAY_MS) },
  });
  for (const build of await due.toArray()) {
    if (!build.appId || !build.ownerId) continue;
    if (await builds.findOne({ appId: build.appId, createdAt: { $gt: build.createdAt } }, { projection: { _id: 1 } })) continue;
    const claimed = await builds.updateOne({ _id: build._id, expiryReminderSent: { $ne: true } }, { $set: { expiryReminderSent: true } });
    if (claimed.modifiedCount !== 1) continue;
    try {
      const user = await users.findOne({ _id: build.ownerId });
      if (!user?.email || !user.emailVerifiedAt) continue;
      const message = buildExpiring({ appUrl, appName: build.config.appName, link: `${appUrl}/my-apps/${build.appId}/builds/${build._id}`, expiresAt: build.expiresAt });
      await mail(String(user.email), message.subject, message.text, message.html);
      sent += 1;
    } catch (error) {
      console.error('Build expiry email failed', (error as Error).message);
      await builds.updateOne({ _id: build._id }, { $set: { expiryReminderSent: false } });
    }
  }
  return { sent };
};
