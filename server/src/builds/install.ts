import { isExpired } from '@sitetoapk/shared/builds';
import express, { Router, type Request, type Response } from 'express';
import type { Document } from 'mongodb';
import type { Auth } from '../auth';
import { buildIconKey } from '../apps/icons';
import { limitRoute } from '../auth/limits';
import { invalid } from '../auth/routes';
import { randomToken, sha256 } from '../auth/tokens';
import type { Builds } from './index';
import { downloadLink } from './routes';

export const INSTALL_LINK_MS = 60 * 60 * 1000;

/** Creates a 1-hour link that opens one build's install page on a phone, with no sign-in. */
export const createInstallLink = async (auth: Auth, deps: Builds, build: Document) => {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + INSTALL_LINK_MS);
  // Only the hash is stored, so a database leak hands out no working links.
  await deps.installTokens.insertOne({ hash: sha256(token), buildId: build._id, expiresAt });
  return { url: `${deps.config.installUrl ?? auth.config.appUrl}/install/${token}`, expiresAt };
};

/** The public routes behind an install link. Every failure looks the same, so tokens can't be probed. */
export const installRouter = (auth: Auth, deps: Builds) => {
  const router = Router();
  router.use(express.json({ limit: '1kb' }));

  const gone = (res: Response) => res.status(410).json({ error: 'This install link has expired. Make a new one from your app’s build page.' });

  /** The build behind a live token, while it still has its APK. */
  const buildFor = async (req: Request) => {
    const token = String(req.params.token);
    if (!/^[\w-]{43}$/.test(token)) return null;
    const entry = await deps.installTokens.findOne({ hash: sha256(token), expiresAt: { $gt: new Date() } });
    if (!entry) return null;
    const build = await deps.builds.findOne({ _id: entry.buildId });
    const usable = build?.status === 'success' && build.artifactKey && !isExpired(build as never);
    return usable ? build : null;
  };

  router.get('/:token', async (req, res) => {
    const build = await buildFor(req);
    if (!build) return gone(res);
    res.set('Cache-Control', 'no-store').json({
      appName: build.config.appName,
      versionName: build.versionName,
      versionCode: build.versionCode,
      artifactBytes: build.artifactBytes,
    });
  });

  router.get('/:token/icon', async (req, res) => {
    const build = await buildFor(req);
    const data = build ? await deps.storage.get(buildIconKey(String(build._id))) : null;
    if (!data) return gone(res);
    res.set('Cache-Control', 'private, no-store').type('image/png').send(data);
  });

  // Only the download is limited: it costs bandwidth, while the page and icon are small, and a
  // 256-bit token can't be guessed. One visit makes three requests, so a shared limit locked phones out.
  router.get('/:token/download', limitRoute(auth, 'install-download'), async (req, res) => {
    const build = await buildFor(req);
    if (!build) return gone(res);
    const link = await downloadLink(deps, build as never);
    if (link.url === undefined) return gone(res);
    res.redirect(302, link.url);
  });

  router.use(invalid);
  return router;
};
