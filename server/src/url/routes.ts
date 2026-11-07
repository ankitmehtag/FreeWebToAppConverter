import express, { Router } from 'express';
import { z } from 'zod';
import type { Auth } from '../auth';
import { limitRoute } from '../auth/limits';
import { allowOrigin, invalid } from '../auth/routes';
import type { UnsafeChecker } from '../abuse/unsafe';
import { checkUrl, isListed } from './check';
import type { FetchUrl } from './fetcher';
import { ShotFailure, type Screenshot } from './screenshot';

const check = z.strictObject({ url: z.string().min(1).max(2048) });
const shot = z.strictObject({ url: z.string().min(1).max(2048) });

export const urlRouter = (auth: Auth, fetchUrl: FetchUrl, unsafe?: UnsafeChecker, screenshot?: Screenshot) => {
  const router = Router();
  router.use(allowOrigin(auth), express.json({ limit: '10kb' }));

  router.post('/check', limitRoute(auth, 'url-check'), async (req, res) => {
    const { url } = check.parse(req.body);
    res.json(await checkUrl(fetchUrl, url, unsafe));
  });

  // For a site that won't be framed: a picture of it, so the phone preview still shows something real.
  if (screenshot) {
    router.get('/screenshot', limitRoute(auth, 'url-screenshot'), async (req, res) => {
      const { url } = shot.parse(req.query);
      try {
        if (unsafe && (await isListed(unsafe, [url]))) {
          res.status(422).json({ error: 'unsafe' });
          return;
        }
        const image = await screenshot(url);
        res.set('Cache-Control', 'public, max-age=3600').type('image/jpeg').send(image);
      } catch (error) {
        if (!(error instanceof ShotFailure)) throw error;
        if (error.code === 'busy') res.status(503).json({ error: 'busy' });
        else if (error.code === 'unavailable') res.status(502).json({ error: 'unavailable' });
        else res.status(422).json({ error: error.code });
      }
    });
  }

  router.use(invalid);
  return router;
};
