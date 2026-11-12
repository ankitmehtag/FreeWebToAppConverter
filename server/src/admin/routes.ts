import cookieParser from 'cookie-parser';
import express, { Router, type NextFunction, type Request, type Response } from 'express';
import { ObjectId, type Document } from 'mongodb';
import { z } from 'zod';
import { FINAL_STATUSES, queueBuild } from '@sitetoapk/shared/builds';
import { setPlan } from '../apps/plan';
import type { Builds } from '../builds';
import { accountDisabled } from '@sitetoapk/shared/mail';
import { allowOrigin, invalid } from '../auth/routes';
import { requireCsrf, requireSession, revokeAllSessions } from '../auth/session';
import { normalizeCode } from '../payments/coupons';
import { refundOrder } from '../payments/refunds';
import type { Payments } from '../payments/routes';
import type { Apps } from '../apps';
import type { Admin } from './index';
import { checkCode, unseal } from './totp';

const DAY = 24 * 60 * 60 * 1000;
const VERIFIED_FOR_MS = 12 * 60 * 60 * 1000;
const REQUESTS_PER_MINUTE = 120;
const CODE_TRIES = 5;
const CODE_WINDOW_MS = 15 * 60 * 1000;

const id24 = z.string().regex(/^[0-9a-f]{24}$/);
const reason = z.string().trim().min(3).max(200);
const planBody = z.strictObject({ plan: z.enum(['free', 'premium']), reason });
const reasonBody = z.strictObject({ reason });
const codeBody = z.strictObject({ code: z.string().regex(/^\d{6}$/) });
const couponBody = z.strictObject({
  code: z.string().trim().regex(/^[A-Za-z0-9_-]{3,32}$/),
  kind: z.enum(['percent', 'flat']),
  percent: z.number().int().min(1).max(100).optional(),
  flatInr: z.number().int().positive().optional(),
  maxUses: z.number().int().positive().max(100000).default(100),
  perUserLimit: z.number().int().positive().max(100).default(1),
  days: z.number().int().positive().max(365).default(30),
  reason,
});

type Deps = { admin: Admin; builds?: Builds; apps?: Apps; payments?: Payments };

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const limit = (value: unknown, fallback = 50) => Math.min(Math.max(Number(value) || fallback, 1), 200);

/** An id as the string the browser sees; secrets never go through these views. */
const view = <T extends Document>(doc: T, keep: string[]) => ({ id: String(doc._id), ...Object.fromEntries(keep.filter((key) => doc[key] !== undefined).map((key) => [key, doc[key]])) });

export const adminRouter = ({ admin, builds, apps, payments }: Deps) => {
  const { auth } = admin;
  const router = Router();
  const csrf = requireCsrf(auth);
  const users = auth.users;
  const appsCol = apps?.apps;
  const buildsCol = builds?.builds;

  router.use((_req, res, next) => {
    res.set('X-Robots-Tag', 'noindex, nofollow');
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.use(allowOrigin(auth), cookieParser(), express.json({ limit: '10kb' }));

  const notFound = (res: Response) => res.status(404).json({ error: 'Not found' });

  // Anyone who isn't the admin, signed in or not, gets the same answer as for a path that doesn't exist (R1).
  router.use(async (req: Request, res: Response, next: NextFunction) => {
    const count = await auth.redis.incr(`rate:admin:${req.ip}`);
    if (count === 1) await auth.redis.pexpire(`rate:admin:${req.ip}`, 60_000);
    if (count > REQUESTS_PER_MINUTE) return void res.status(429).json({ error: 'Too many requests' });

    const quiet = { locals: res.locals, status: () => ({ json: () => notFound(res) }) } as unknown as Response;
    await requireSession(auth)(req, quiet, async () => {
      const user = await users.findOne({ _id: res.locals.session.userId });
      if (!user || !user.emailVerifiedAt || user.disabledAt || !admin.adminEmails.includes(String(user.email))) return void notFound(res);
      res.locals.admin = user;
      next();
    });
  });

  const verified = (_req: Request, res: Response, next: NextFunction) => {
    const at: unknown = res.locals.session.adminVerifiedAt;
    if (at instanceof Date && Date.now() - at.getTime() < VERIFIED_FOR_MS) return next();
    res.status(401).json({ error: 'Second step required', reason: 'two_factor' });
  };

  const record = (res: Response, action: string, target: { kind: string; id: string }, why: string, detail: Document = {}) =>
    admin.audit.insertOne({ createdAt: new Date(), actor: res.locals.admin.email, action, target, reason: why, detail });

  router.get('/2fa', async (_req, res) => {
    const state = await admin.state.findOne({ _id: res.locals.admin._id });
    const at: unknown = res.locals.session.adminVerifiedAt;
    res.json({ enrolled: Boolean(state), verified: at instanceof Date && Date.now() - at.getTime() < VERIFIED_FOR_MS });
  });

  // Enrolling is done on the server with `npm run admin-2fa`, never over the web, so a stolen password can't add a second step of its own.
  router.post('/2fa/verify', csrf, async (req, res) => {
    const { code } = codeBody.parse(req.body);
    const state = await admin.state.findOne({ _id: res.locals.admin._id });
    if (!state) return void res.status(409).json({ error: 'Two-step sign-in is not set up. Run admin-2fa on the server.' });

    const triesKey = `admin:2fa:${String(res.locals.admin._id)}`;
    if (Number(await auth.redis.get(triesKey)) >= CODE_TRIES) return void res.status(429).json({ error: 'Too many wrong codes. Try again later.' });

    const step = checkCode(unseal(auth.config.jwtSecret, String(state.sealed)), code);
    // A step that was already used is refused, so a code seen over a shoulder is worth nothing.
    if (step === null || step <= Number(state.lastStep ?? 0)) {
      const tries = await auth.redis.incr(triesKey);
      if (tries === 1) await auth.redis.pexpire(triesKey, CODE_WINDOW_MS);
      return void res.status(401).json({ error: 'Wrong code' });
    }
    await auth.redis.del(triesKey);
    const taken = await admin.state.updateOne({ _id: state._id, $or: [{ lastStep: { $lt: step } }, { lastStep: { $exists: false } }] }, { $set: { lastStep: step } });
    if (taken.modifiedCount !== 1) return void res.status(401).json({ error: 'Wrong code' });
    await auth.sessions.updateOne({ _id: res.locals.session._id }, { $set: { adminVerifiedAt: new Date() } });
    res.status(204).end();
  });

  router.use(verified);

  router.get('/overview', async (_req, res) => {
    const now = Date.now();
    const since = (ms: number) => new Date(now - ms);
    const count = (col: { countDocuments: (q: Document) => Promise<number> } | undefined, q: Document) => (col ? col.countDocuments(q) : Promise.resolve(0));
    const week = since(7 * DAY);
    const recent = buildsCol ? await buildsCol.find({ createdAt: { $gte: week } }, { projection: { status: 1, createdAt: 1, updatedAt: 1 } }).toArray() : [];
    const done = recent.filter((build) => FINAL_STATUSES.includes(String(build.status)) && build.status !== 'canceled');
    const times = recent.filter((build) => build.status === 'success').map((build) => build.updatedAt.getTime() - build.createdAt.getTime()).sort((a, b) => a - b);
    const revenue = payments
      ? await payments.orders.aggregate([{ $match: { status: 'paid' } }, { $group: { _id: '$currency', total: { $sum: '$amount' }, orders: { $sum: 1 } } }]).toArray()
      : [];
    res.json({
      users: { total: await users.countDocuments({}), last24h: await users.countDocuments({ createdAt: { $gte: since(DAY) } }) },
      apps: { total: await count(appsCol, {}), premium: await count(appsCol, { plan: 'premium' }) },
      builds: {
        last24h: await count(buildsCol, { createdAt: { $gte: since(DAY) } }),
        last7d: recent.length,
        successRate7d: done.length ? Math.round((recent.filter((build) => build.status === 'success').length / done.length) * 100) : null,
        medianSeconds7d: times.length ? Math.round(times[Math.floor(times.length / 2)]! / 1000) : null,
        queued: await count(buildsCol, { status: 'queued' }),
        running: await count(buildsCol, { status: { $in: ['building', 'signing', 'uploading'] } }),
      },
      revenue: revenue.map((row) => ({ currency: row._id, total: row.total, orders: row.orders })),
    });
  });

  const USER_FIELDS = ['email', 'createdAt', 'emailVerifiedAt', 'disabledAt'];
  const APP_FIELDS = ['plan', 'ownerId', 'ready', 'takenDown', 'buildCount', 'createdAt'];
  const BUILD_FIELDS = ['appId', 'ownerId', 'status', 'plan', 'versionName', 'versionCode', 'failureKind', 'error', 'createdAt', 'updatedAt', 'history'];
  const ORDER_FIELDS = ['userId', 'appId', 'amount', 'currency', 'status', 'provider', 'couponId', 'createdAt', 'paidAt', 'refundedAt', 'refundId'];
  const appView = (app: Document) => ({ ...view(app, APP_FIELDS), name: (app.draft as Document | undefined)?.appName });

  router.get('/users', async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase().slice(0, 100) : '';
    const found = await users.find(q ? { email: { $regex: escapeRegex(q) } } : {}, { sort: { createdAt: -1 }, limit: limit(req.query.limit) }).toArray();
    res.json(found.map((user) => view(user, USER_FIELDS)));
  });

  router.get('/users/:id', async (req, res) => {
    if (!id24.safeParse(req.params.id).success) return void notFound(res);
    const _id = new ObjectId(String(req.params.id));
    const user = await users.findOne({ _id });
    if (!user) return void notFound(res);
    const [userApps, userBuilds, userOrders] = await Promise.all([
      appsCol ? appsCol.find({ ownerId: _id }).limit(100).toArray() : [],
      buildsCol ? buildsCol.find({ ownerId: _id }, { sort: { createdAt: -1 }, limit: 20 }).toArray() : [],
      payments ? payments.orders.find({ userId: _id }, { sort: { createdAt: -1 }, limit: 20 }).toArray() : [],
    ]);
    res.json({ user: view(user, USER_FIELDS), apps: userApps.map(appView), builds: userBuilds.map((b) => view(b, BUILD_FIELDS)), orders: userOrders.map((o) => view(o, ORDER_FIELDS)) });
  });

  router.get('/apps', async (req, res) => {
    const filter: Document = {};
    if (req.query.plan === 'free' || req.query.plan === 'premium') filter.plan = req.query.plan === 'free' ? { $ne: 'premium' } : 'premium';
    res.json((await appsCol?.find(filter, { sort: { createdAt: -1 }, limit: limit(req.query.limit) }).toArray() ?? []).map(appView));
  });

  router.get('/builds', async (req, res) => {
    const filter: Document = {};
    if (typeof req.query.status === 'string') filter.status = req.query.status;
    if (req.query.plan === 'free' || req.query.plan === 'premium') filter.plan = req.query.plan;
    res.json((await buildsCol?.find(filter, { sort: { createdAt: -1 }, limit: limit(req.query.limit) }).toArray() ?? []).map((b) => view(b, BUILD_FIELDS)));
  });

  router.get('/builds/:id', async (req, res) => {
    const build = await buildsCol?.findOne({ _id: String(req.params.id) as never });
    if (!build || !builds) return void notFound(res);
    const log = await builds.buildLogs.findOne({ _id: build._id });
    res.json({ ...view(build, BUILD_FIELDS), log: Array.isArray(log?.lines) ? log.lines : [] });
  });

  router.get('/orders', async (req, res) => {
    const filter: Document = typeof req.query.status === 'string' ? { status: req.query.status } : {};
    res.json((await payments?.orders.find(filter, { sort: { createdAt: -1 }, limit: limit(req.query.limit) }).toArray() ?? []).map((o) => view(o, ORDER_FIELDS)));
  });

  router.get('/audit', async (req, res) => {
    const entries = await admin.audit.find({}, { sort: { createdAt: -1 }, limit: limit(req.query.limit, 100) }).toArray();
    res.json(entries.map((entry) => view(entry, ['createdAt', 'actor', 'action', 'target', 'reason', 'detail'])));
  });

  router.post('/apps/:id/plan', csrf, async (req, res) => {
    const body = planBody.parse(req.body);
    if (!appsCol || !id24.safeParse(req.params.id).success) return void notFound(res);
    const appId = new ObjectId(String(req.params.id));
    const before = await appsCol.findOne({ _id: appId });
    if (!before || !(await setPlan(appsCol, appId, body.plan))) return void notFound(res);
    await record(res, 'app.plan', { kind: 'app', id: String(appId) }, body.reason, { from: before.plan ?? 'free', to: body.plan });
    res.status(204).end();
  });

  router.post('/builds/:id/retry', csrf, async (req, res) => {
    const { reason: why } = reasonBody.parse(req.body);
    if (!buildsCol || !builds) return void notFound(res);
    const buildId = String(req.params.id);
    const build = await buildsCol.findOne({ _id: buildId as never });
    if (!build) return void notFound(res);
    if (build.status !== 'failed') return void res.status(409).json({ error: `The build is ${build.status}; only a failed build can be retried` });
    try {
      const moved = await buildsCol.updateOne(
        { _id: buildId as never, status: 'failed' },
        {
          $set: { status: 'queued', updatedAt: new Date(), countsTowardLimit: false, ...(build.appId ? { activeAppId: build.appId } : {}) },
          $unset: { error: '', failureKind: '' },
          $push: { history: 'queued' } as never,
        },
      );
      if (moved.modifiedCount !== 1) return void res.status(409).json({ error: 'The build changed; reload and try again' });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) return void res.status(409).json({ error: 'This app already has a build running' });
      throw error;
    }
    await queueBuild(builds.queue as never, buildId);
    await record(res, 'build.retry', { kind: 'build', id: buildId }, why);
    res.status(204).end();
  });

  router.post('/builds/:id/cancel', csrf, async (req, res) => {
    const { reason: why } = reasonBody.parse(req.body);
    if (!buildsCol || !builds) return void notFound(res);
    const buildId = String(req.params.id);
    const build = await buildsCol.findOne({ _id: buildId as never });
    if (!build) return void notFound(res);
    // A build already running is left to finish: stopping it halfway could leave a half-signed file.
    const moved = await buildsCol.updateOne(
      { _id: buildId as never, status: 'queued' },
      { $set: { status: 'canceled', updatedAt: new Date(), countsTowardLimit: false }, $push: { history: 'canceled' } as never, $unset: { activeAppId: '' } },
    );
    if (moved.modifiedCount !== 1) return void res.status(409).json({ error: `The build is ${build.status}; only a queued build can be canceled` });
    await (builds.queue as { remove?: (id: string) => Promise<unknown> }).remove?.(buildId);
    await record(res, 'build.cancel', { kind: 'build', id: buildId }, why);
    res.status(204).end();
  });

  const setDisabled = (disabled: boolean) => async (req: Request, res: Response) => {
    const { reason: why } = reasonBody.parse(req.body);
    if (!id24.safeParse(req.params.id).success) return void notFound(res);
    const _id = new ObjectId(String(req.params.id));
    if (String(_id) === String(res.locals.admin._id)) return void res.status(409).json({ error: 'You cannot disable your own account' });
    const done = await users.updateOne({ _id }, disabled ? { $set: { disabledAt: new Date() } } : { $unset: { disabledAt: '' } });
    if (done.matchedCount !== 1) return void notFound(res);
    if (disabled) {
      await revokeAllSessions(auth, _id);
      const target = await users.findOne({ _id });
      if (target?.email) auth.mailer.send({ to: String(target.email), ...accountDisabled({ appUrl: auth.config.appUrl, contact: admin.contactEmail }) }).catch(() => console.error('Account email failed'));
    }
    await record(res, disabled ? 'user.disable' : 'user.enable', { kind: 'user', id: String(_id) }, why);
    res.status(204).end();
  };
  router.post('/users/:id/disable', csrf, setDisabled(true));
  router.post('/users/:id/enable', csrf, setDisabled(false));

  router.post('/orders/:id/refund', csrf, async (req, res) => {
    const { reason: why } = reasonBody.parse(req.body);
    if (!payments) return void res.status(503).json({ error: 'Payments are off on this server' });
    const orderId = String(req.params.id);
    // One refund at a time per order, so a double click can't reach the provider twice.
    const lock = await auth.redis.set(`admin:refund:${orderId}`, '1', 'PX', 60_000, 'NX');
    if (!lock) return void res.status(409).json({ error: 'A refund for this order is already running' });
    try {
      const result = await refundOrder(payments, orderId, { force: true });
      await record(res, 'order.refund', { kind: 'order', id: orderId }, why, result.ok ? { refundId: result.refundId } : { refused: result.reason });
      if (!result.ok) return void res.status(409).json({ error: result.reason });
      res.status(200).json({ refundId: result.refundId });
    } finally {
      await auth.redis.del(`admin:refund:${orderId}`);
    }
  });

  router.post('/coupons', csrf, async (req, res) => {
    const body = couponBody.parse(req.body);
    if (body.kind === 'percent' ? body.percent === undefined : body.flatInr === undefined) return void res.status(400).json({ error: 'Invalid request' });
    const code = normalizeCode(body.code);
    const doc = {
      code,
      plan: 'premium',
      maxUses: body.maxUses,
      perUserLimit: body.perUserLimit,
      used: 0,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + body.days * DAY),
      ...(body.kind === 'percent' ? { kind: 'percent', percent: body.percent } : { kind: 'flat', flat: { INR: body.flatInr } }),
    };
    try {
      await admin.coupons.insertOne(doc);
    } catch (error) {
      if ((error as { code?: number }).code === 11000) return void res.status(409).json({ error: 'That code already exists' });
      throw error;
    }
    await record(res, 'coupon.create', { kind: 'coupon', id: code }, body.reason, { kind: body.kind, percent: body.percent, flatInr: body.flatInr, maxUses: body.maxUses, days: body.days });
    res.status(201).json({ code });
  });

  router.use((_req, res) => notFound(res));
  router.use(invalid);
  return router;
};
