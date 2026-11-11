import cookieParser from 'cookie-parser';
import express, { Router } from 'express';
import { ObjectId, type Collection } from 'mongodb';
import { readKeystore, type Keyring, type Keystores } from '@sitetoapk/shared/keystore';
import type { Auth } from '../auth';
import { allowOrigin } from '../auth/routes';
import { requireCsrf, requireSession } from '../auth/session';
import { makeZip } from './zip';

export type Keys = { keystores: Keystores; downloads: Collection; ring: Keyring };

/** A download that has not finished within this time may be started again. */
const CLAIM_MS = 2 * 60 * 1000;

const details = (key: { alias: string; storePassword: string; keyPassword: string; sha1: string; sha256: string }) =>
  [
    'Signing key for your Premium app',
    '',
    `Key alias:      ${key.alias}`,
    `Store password: ${key.storePassword}`,
    `Key password:   ${key.keyPassword}`,
    `Certificate SHA-1:   ${key.sha1}`,
    `Certificate SHA-256: ${key.sha256}`,
    '',
    'Keep keystore.p12 and this file somewhere safe, apart from each other if you can.',
    'Google Play only accepts updates signed with this key. We cannot give it to you a second time.',
    'If you use Play App Signing, this is your upload key, and Google may hold the final signing key.',
    '',
  ].join('\n');

export const keysRouter = (auth: Auth, { keystores, downloads, ring }: Keys) => {
  const router = Router();
  const csrf = requireCsrf(auth);
  router.use(allowOrigin(auth), cookieParser(), express.json({ limit: '1kb' }), requireSession(auth));

  /** The owner's key record. Another user's key and a missing one look the same. */
  const ownFilter = (req: express.Request, res: express.Response) => {
    const id = String(req.params.appId);
    if (!/^[0-9a-f]{24}$/.test(id)) return null;
    return { appId: new ObjectId(id), ownerId: res.locals.session.userId as ObjectId };
  };

  router.get('/:appId', async (req, res) => {
    const filter = ownFilter(req, res);
    const record = filter && (await keystores.findOne(filter));
    if (!record) return res.status(404).json({ error: 'No key for this app' });
    res.set('Cache-Control', 'no-store').json({
      downloaded: Boolean(record.downloadedAt),
      createdAt: record.createdAt,
      sha1: record.sha1,
      sha256: record.sha256,
      eraseOn: record.deleteAfter ?? undefined,
    });
  });

  router.post('/:appId/download', csrf, async (req, res) => {
    const filter = ownFilter(req, res);
    if (!filter) return res.status(404).json({ error: 'No key for this app' });
    if (req.body?.confirm !== true) return res.status(400).json({ error: 'Confirm that you understand before downloading the key' });

    // The claim is taken before anything is sent, so two requests cannot both get the key.
    const now = new Date();
    const claimed = await keystores.findOneAndUpdate(
      { ...filter, downloadedAt: null, $or: [{ downloadClaimedAt: null }, { downloadClaimedAt: { $lt: new Date(now.getTime() - CLAIM_MS) } }] } as never,
      { $set: { downloadClaimedAt: now } as never },
    );
    if (!claimed) {
      const existing = await keystores.findOne(filter);
      if (!existing) return res.status(404).json({ error: 'No key for this app' });
      return res.status(409).json({ error: 'This key has already been downloaded. We cannot give it out a second time.' });
    }

    const key = await readKeystore(keystores, ring, filter.appId);
    if (!key) return res.status(404).json({ error: 'No key for this app' });
    const zip = makeZip([
      { name: 'keystore.p12', data: key.secrets.keystore },
      { name: 'key-details.txt', data: Buffer.from(details({ ...key.secrets, sha1: key.sha1, sha256: key.sha256 })) },
    ]);

    // Counted as downloaded only once it has gone out. A dropped connection gives the owner another try.
    res.on('finish', () => {
      void keystores.updateOne(filter, { $set: { downloadedAt: new Date() }, $unset: { downloadClaimedAt: '' } } as never);
      void downloads.insertOne({ appId: filter.appId, userId: filter.ownerId, at: new Date() });
    });
    res.on('close', () => {
      if (!res.writableFinished) void keystores.updateOne(filter, { $unset: { downloadClaimedAt: '' } } as never);
    });
    res
      .status(200)
      .set({
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="signing-key-${filter.appId}.zip"`,
        'Cache-Control': 'no-store',
        'Content-Length': String(zip.length),
      })
      .end(zip);
  });

  return router;
};
