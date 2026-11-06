import express, { Router } from 'express';
import { z } from 'zod';
import type { Auth } from '../auth';
import { limitRoute } from '../auth/limits';
import { allowOrigin, invalid } from '../auth/routes';
import type { UnsafeChecker } from '../abuse/unsafe';
import { checkUrl } from './check';
import type { FetchUrl } from './fetcher';

const check = z.strictObject({ url: z.string().min(1).max(2048) });

export const urlRouter = (auth: Auth, fetchUrl: FetchUrl, unsafe?: UnsafeChecker) => {
  const router = Router();
  router.use(allowOrigin(auth), express.json({ limit: '10kb' }));

  router.post('/check', limitRoute(auth, 'url-check'), async (req, res) => {
    const { url } = check.parse(req.body);
    res.json(await checkUrl(fetchUrl, url, unsafe));
  });

  router.use(invalid);
  return router;
};
