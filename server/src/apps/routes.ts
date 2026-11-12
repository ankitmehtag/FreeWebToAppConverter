import cookieParser from 'cookie-parser';
import express, { Router, type ErrorRequestHandler, type Response } from 'express';
import { ObjectId, type Document } from 'mongodb';
import { z } from 'zod';
import { draftSchema, toAppConfig, type Draft } from '@sitetoapk/shared';
import { checkIcon, IconError, MAX_ICON_BYTES } from '@sitetoapk/shared/icon';
import type { Auth } from '../auth';
import { limitRoute } from '../auth/limits';
import { allowOrigin, invalid } from '../auth/routes';
import { requireCsrf, requireSession } from '../auth/session';
import { hostUrl, UNSAFE_MESSAGE, UnsafeCheckUnavailable, type UnsafeChecker } from '../abuse/unsafe';
import type { FetchUrl } from '../url/fetcher';
import { iconKey } from './icons';
import { planOf } from './plan';
import { MAX_APPS_PER_USER, PUSH_PER_DAY, type Apps } from './index';
import { prefill } from './prefill';
import type { Builds } from '../builds';
import { buildView, startBuild } from '../builds/start';

const DUPLICATE_KEY = 11000;

const prefillRequest = z.strictObject({ url: z.string().min(1).max(2048) });

const isReady = (draft: Draft, iconKey: unknown) => Boolean(iconKey) && toAppConfig(draft) !== null;

const view = (app: Document, latestBuild?: Document) => ({
  id: String(app._id),
  latestBuild: latestBuild ? buildView(latestBuild) : undefined,
  draft: app.draft,
  plan: planOf(app),
  ready: app.ready,
  locked: Boolean(app.lockedAt),
  hasIcon: Boolean(app.iconKey),
  takenDown: app.takenDown ? { reason: app.takenDown.reason, at: app.takenDown.at } : undefined,
  createdAt: app.createdAt,
  updatedAt: app.updatedAt,
});

const ownerOf = (res: Response) => res.locals.session.userId as ObjectId;

/** A taken-down app can't be changed or built until it is restored. */
const takenDown = (res: Response, app: Document) =>
  res.status(403).json({ error: `This app was taken down: ${app.takenDown.reason}`, reason: 'taken_down' });

/** Another user's app and a missing one look the same, so ids can't be probed. */
const appFilter = (res: Response, id: unknown) =>
  typeof id === 'string' && /^[0-9a-f]{24}$/.test(id) ? { _id: new ObjectId(id), ownerId: ownerOf(res) } : null;

const adsPremium = (res: Response) => res.status(403).json({ error: 'Ads are a Premium feature. Upgrade this app to turn them on.', reason: 'ads_premium' });

const notFound = (res: Response) => res.status(404).json({ error: 'App not found' });

const duplicateName = (res: Response) =>
  res.status(409).json({ error: 'Invalid request', fields: { packageName: 'You already have an app with this package name' } });

const isDuplicate = (error: unknown) => (error as { code?: number }).code === DUPLICATE_KEY;


/** Answers with an error per field, so that the wizard can show each one next to its input. */
const fieldErrors: ErrorRequestHandler = (error, _req, res, next) => {
  if (error instanceof IconError) return res.status(400).json({ error: 'Invalid request', fields: { icon: error.message } });
  if ((error as { type?: string }).type === 'entity.too.large') {
    return res.status(413).json({ error: 'Invalid request', fields: { icon: 'Icon must be 5 MB or smaller' } });
  }
  if (!(error instanceof z.ZodError)) return next(error);
  const fields = Object.fromEntries(error.issues.map((issue) => [issue.path.join('.') || '_', issue.message]));
  res.status(400).json({ error: 'Invalid request', fields });
};

/** The fields whose sites are on the unsafe list. Only changed sites are checked, and it fails open. */
const unsafeFields = async (unsafe: UnsafeChecker | undefined, draft: Draft, before: Draft = {}) => {
  if (!unsafe) return null;
  const sameHosts = JSON.stringify(draft.internalHosts ?? []) === JSON.stringify(before.internalHosts ?? []);
  const checks: [string, string[]][] = [
    ['startUrl', draft.startUrl && draft.startUrl !== before.startUrl ? [draft.startUrl] : []],
    ['internalHosts', sameHosts ? [] : (draft.internalHosts ?? []).map(hostUrl)],
  ];
  try {
    for (const [field, urls] of checks) {
      if (urls.length && (await unsafe(urls)) === 'unsafe') return { [field]: UNSAFE_MESSAGE };
    }
  } catch (error) {
    if (!(error instanceof UnsafeCheckUnavailable)) throw error;
  }
  return null;
};

const pushRequest = z.strictObject({ title: z.string().trim().min(1).max(60), body: z.string().trim().min(1).max(200) });

export const appsRouter = (auth: Auth, { apps, icons, pushes, sendPush }: Apps, fetchUrl?: FetchUrl, builds?: Builds, unsafe?: UnsafeChecker) => {
  const router = Router();
  const session = requireSession(auth);
  const csrf = requireCsrf(auth);

  router.use(allowOrigin(auth), cookieParser(), express.json({ limit: '10kb' }), session);

  /** The newest build of each app, found in one query. */
  const latestBuilds = async (ownerId: ObjectId, appIds: ObjectId[]) => {
    if (!builds || appIds.length === 0) return new Map<string, Document>();
    const rows = await builds.builds
      .aggregate([
        { $match: { ownerId, appId: { $in: appIds } } },
        { $sort: { createdAt: -1 } },
        { $group: { _id: '$appId', build: { $first: '$$ROOT' } } },
      ])
      .toArray();
    return new Map(rows.map((row) => [String(row._id), row.build as Document]));
  };

  router.get('/', async (_req, res) => {
    const list = await apps.find({ ownerId: ownerOf(res) }).sort({ updatedAt: -1 }).toArray();
    const latest = await latestBuilds(ownerOf(res), list.map((app) => app._id));
    res.json(list.map((app) => view(app, latest.get(String(app._id)))));
  });

  router.post('/', csrf, async (req, res) => {
    const draft = draftSchema.parse(req.body);
    if (draft.ads?.enabled) return adsPremium(res);
    const listed = await unsafeFields(unsafe, draft);
    if (listed) return res.status(400).json({ error: 'Invalid request', fields: listed });
    const ownerId = ownerOf(res);
    if ((await apps.countDocuments({ ownerId })) >= MAX_APPS_PER_USER) {
      res.status(409).json({ error: `You can have up to ${MAX_APPS_PER_USER} apps` });
      return;
    }
    const now = new Date();
    const app = { ownerId, draft, ready: false, buildCount: 0, createdAt: now, updatedAt: now };
    try {
      const { insertedId } = await apps.insertOne(app);
      res.status(201).json(view({ ...app, _id: insertedId }));
    } catch (error) {
      if (!isDuplicate(error)) throw error;
      duplicateName(res);
    }
  });

  if (fetchUrl) {
    router.post('/prefill', csrf, limitRoute(auth, 'prefill'), async (req, res) => {
      const { url } = prefillRequest.parse(req.body);
      res.json(await prefill(fetchUrl, url));
    });
  }

  if (builds) router.post('/:id/builds', csrf, limitRoute(auth, 'build-start'), startBuild(auth, apps, builds, { fetchUrl, unsafe }));

  router.get('/:id', async (req, res) => {
    const filter = appFilter(res, req.params.id);
    const app = filter && (await apps.findOne(filter));
    if (!app) return notFound(res);
    const latest = await latestBuilds(ownerOf(res), [app._id]);
    // Installs of a Free build can't update to a Premium one, which uses the app's own key.
    const reinstallWarning =
      Boolean(builds) &&
      planOf(app) === 'premium' &&
      (app.buildCount ?? 0) > 0 &&
      !(await builds!.builds.findOne({ appId: app._id, plan: 'premium' }, { projection: { _id: 1 } }));
    res.json({ ...view(app, latest.get(String(app._id))), reinstallWarning });
  });

  router.get('/:id/builds', async (req, res) => {
    const filter = appFilter(res, req.params.id);
    const app = filter && (await apps.findOne(filter));
    if (!app || !builds) return notFound(res);
    const list = await builds.builds.find({ appId: app._id, ownerId: ownerOf(res) }).sort({ createdAt: -1 }).limit(10).toArray();
    res.json(list.map(buildView));
  });

  router.post('/:id/push', csrf, limitRoute(auth, 'push'), async (req, res) => {
    const filter = appFilter(res, req.params.id);
    const app = filter && (await apps.findOne(filter));
    if (!app) return notFound(res);
    if (app.takenDown) return takenDown(res, app);
    if (!sendPush) return res.status(503).json({ error: 'Push notifications are not available right now' });
    if (!app.draft?.ui?.push || !app.lockedAt) {
      return res.status(409).json({ error: 'Turn on push notifications and build the app first' });
    }
    const message = pushRequest.parse(req.body);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    if ((await pushes.countDocuments({ appId: app._id, at: { $gte: since } })) >= PUSH_PER_DAY) {
      return res.status(429).json({ error: `You can send ${PUSH_PER_DAY} notifications a day per app` });
    }
    await pushes.insertOne({ appId: app._id, at: new Date() });
    await sendPush(String(app._id), message);
    res.status(204).end();
  });

  router.put('/:id', csrf, async (req, res) => {
    const filter = appFilter(res, req.params.id);
    if (!filter) return notFound(res);
    const draft = draftSchema.parse(req.body);

    const current = await apps.findOne(filter);
    if (!current) return notFound(res);
    if (current.takenDown) return takenDown(res, current);
    if (draft.ads?.enabled && planOf(current) !== 'premium') return adsPremium(res);
    const listed = await unsafeFields(unsafe, draft, current.draft);
    if (listed) return res.status(400).json({ error: 'Invalid request', fields: listed });

    // The lock is part of the filter, so that a build finishing mid-save can't be raced.
    const unlockedOrSameName = [{ lockedAt: null }, ...(draft.packageName ? [{ 'draft.packageName': draft.packageName }] : [])];
    try {
      const updated = await apps.findOneAndUpdate(
        { ...filter, $or: unlockedOrSameName },
        { $set: { draft, ready: isReady(draft, current.iconKey), updatedAt: new Date() } },
        { returnDocument: 'after' },
      );
      if (updated) return res.json(view(updated));
    } catch (error) {
      if (!isDuplicate(error)) throw error;
      return duplicateName(res);
    }
    if (await apps.findOne(filter)) {
      res.status(409).json({ error: 'Invalid request', fields: { packageName: 'The package name can’t change after the first build' } });
    } else {
      notFound(res);
    }
  });

  router.delete('/:id', csrf, async (req, res) => {
    const filter = appFilter(res, req.params.id);
    if (!filter) return notFound(res);
    const deleted = await apps.findOneAndDelete({ ...filter, buildCount: 0 });
    if (deleted) {
      if (deleted.iconKey) await icons.remove(deleted.iconKey);
      return res.status(204).end();
    }
    if (await apps.findOne(filter)) res.status(409).json({ error: 'An app that has been built can’t be deleted' });
    else notFound(res);
  });

  // Any content type is read, so that the file's own bytes decide whether it is a PNG.
  router.post('/:id/icon', csrf, express.raw({ type: () => true, limit: MAX_ICON_BYTES }), async (req, res) => {
    const filter = appFilter(res, req.params.id);
    const app = filter && (await apps.findOne(filter));
    if (!filter || !app) return notFound(res);
    if (app.takenDown) return takenDown(res, app);

    const icon = await checkIcon(Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0));
    const key = iconKey(String(app._id));
    await icons.put(key, icon.data);
    const updated = await apps.findOneAndUpdate(
      filter,
      { $set: { iconKey: key, ready: isReady(app.draft, key), updatedAt: new Date() } },
      { returnDocument: 'after' },
    );
    if (!updated) return notFound(res);
    res.json(view(updated));
  });

  router.get('/:id/icon', async (req, res) => {
    const filter = appFilter(res, req.params.id);
    const app = filter && (await apps.findOne(filter));
    const data = app?.iconKey ? await icons.get(app.iconKey) : null;
    if (!data) return notFound(res);
    res.set('Cache-Control', 'private, no-store').type('image/png').send(data);
  });

  router.use(fieldErrors, invalid);
  return router;
};
