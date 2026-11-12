import { abuseReport } from '@sitetoapk/shared/mail';
import express, { Router } from 'express';
import type { Db } from 'mongodb';
import { z } from 'zod';
import type { Auth } from '../auth';
import { limitRoute } from '../auth/limits';
import { allowOrigin, invalid } from '../auth/routes';
import { hmac, sha256 } from '../auth/tokens';
import type { Builds } from '../builds';

export const REPORT_REASONS = ['phishing', 'malware', 'impersonation', 'other'] as const;

const reportRequest = z.strictObject({
  token: z.string().regex(/^[\w-]{43}$/),
  reason: z.enum(REPORT_REASONS),
  details: z.string().trim().max(1000).optional(),
  email: z.string().trim().toLowerCase().email().max(254).optional(),
});

/** Prepares the reports collection. A visitor has one report per app, found by a keyed hash of their IP. */
export const prepareReports = async (db: Db, email?: string) => {
  const reports = db.collection('abuseReports');
  await reports.createIndex({ appId: 1, reporterHash: 1 }, { unique: true });
  await reports.createIndex({ createdAt: -1 });
  return { reports, email };
};

export type Reports = Awaited<ReturnType<typeof prepareReports>>;

/** Lets anyone report an app from its install page, with no account. */
export const reportsRouter = (auth: Auth, deps: Builds, { reports, email: reportsEmail }: Reports) => {
  const router = Router();
  router.use(allowOrigin(auth), express.json({ limit: '4kb' }));

  router.post('/', limitRoute(auth, 'report'), async (req, res) => {
    const { token, reason, details, email } = reportRequest.parse(req.body);
    // An expired link still identifies its app until its record is cleared, so a late report isn't lost.
    const entry = await deps.installTokens.findOne({ hash: sha256(token) });
    const build = entry && (await deps.builds.findOne({ _id: entry.buildId }));
    if (!build?.appId) return res.status(404).json({ error: 'We couldn’t find that app' });

    const now = new Date();
    const result = await reports.updateOne(
      { appId: build.appId, reporterHash: hmac(auth.config.jwtSecret, `report:${req.ip}`) },
      {
        $set: { buildId: build._id, ownerId: build.ownerId, reason, details, email, updatedAt: now },
        $setOnInsert: { createdAt: now, status: 'open' },
      },
      { upsert: true },
    );

    if (result.upsertedId && reportsEmail) {
      await auth.mailer
        .send({
          to: reportsEmail,
          ...abuseReport({ reason, appName: build.config.appName, appId: String(build.appId), packageName: build.config.packageName, site: build.config.startUrl, buildId: String(build._id), reporterEmail: email, details }),
        })
        .catch(() => console.error('Sending the report email failed'));
    }
    res.status(202).json({ status: 'received' });
  });

  router.use(invalid);
  return router;
};
