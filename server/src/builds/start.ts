import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { ObjectId, type Collection, type Document } from 'mongodb';
import { z } from 'zod';
import { planOf, toAppConfig } from '@sitetoapk/shared';
import { createBuild, isExpired, queueBuild, setStatus } from '@sitetoapk/shared/builds';
import { hostUrl, UNSAFE_MESSAGE, UnsafeCheckUnavailable, type UnsafeChecker } from '../abuse/unsafe';
import type { Auth } from '../auth';
import { buildIconKey } from '../apps/icons';
import type { FetchUrl } from '../url/fetcher';
import type { Builds } from './index';

const DUPLICATE_KEY = 11000;
const LOCK_MS = 10_000;
const LOCK_WAIT_MS = 5_000;

export const startRequest = z.strictObject({
  idempotencyKey: z.string().regex(/^[\w-]{8,100}$/),
  versionName: z.string().regex(/^\d+(\.\d+){0,3}$/).max(20).optional(),
});

export const buildView = (build: Document) => ({
  plan: planOf(build),
  id: String(build._id),
  appId: build.appId ? String(build.appId) : undefined,
  status: build.status,
  versionCode: build.versionCode,
  versionName: build.versionName,
  failureKind: build.failureKind,
  artifactBytes: build.artifactBytes,
  sha256: build.sha256,
  expiresAt: build.expiresAt,
  expired: Boolean(build.status === 'success' && (!build.artifactKey || isExpired(build as never))),
  aab: build.aabKey ? { bytes: build.aabBytes, sha256: build.aabSha256 } : undefined,
  signer: build.signerSha256 ? { sha1: build.signerSha1, sha256: build.signerSha256 } : undefined,
  removed: Boolean(build.artifactDeletedAt),
  createdAt: build.createdAt,
  updatedAt: build.updatedAt,
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs work while holding a short per-user lock, so parallel starts can't pass the daily limit together. */
const withUserLock = async <T>({ redis }: Builds, userId: ObjectId, work: () => Promise<T>) => {
  const key = `lock:build-start:${userId}`;
  const token = randomUUID();
  const deadline = Date.now() + LOCK_WAIT_MS;
  while ((await redis.set(key, token, 'PX', LOCK_MS, 'NX')) !== 'OK') {
    if (Date.now() > deadline) throw new Error('Build start lock timed out');
    await sleep(50);
  }
  try {
    return await work();
  } finally {
    // Released only by its holder, in case the lock already ran out and someone else took it.
    if ((await redis.get(key)) === token) await redis.del(key);
  }
};

type Outcome =
  | { kind: 'refused'; status: number; body: Record<string, unknown> }
  | { kind: 'started' | 'repeat'; build: Document };

const refuse = (status: number, reason: string, error: string, extra: object = {}): Outcome => ({
  kind: 'refused',
  status,
  body: { error, reason, ...extra },
});

/** Every site the app opens: the start URL, where it redirects to, and each internal host. */
const sitesOf = async (config: NonNullable<ReturnType<typeof toAppConfig>>, fetchUrl?: FetchUrl) => {
  let final: string | undefined;
  try {
    final = fetchUrl ? (await fetchUrl(config.startUrl)).url : undefined;
  } catch {
    // An unreachable site still gets its start URL and hosts checked.
  }
  return [config.startUrl, ...(final ? [final] : []), ...config.internalHosts.map(hostUrl)];
};

type Safety = { fetchUrl?: FetchUrl; unsafe?: UnsafeChecker };

export const startBuild = (auth: Auth, apps: Collection, deps: Builds, { fetchUrl, unsafe }: Safety = {}) => async (req: Request, res: Response) => {
  const { idempotencyKey, versionName } = startRequest.parse(req.body);
  const ownerId = res.locals.session.userId as ObjectId;
  const appIdText = String(req.params.id);
  if (!/^[0-9a-f]{24}$/.test(appIdText)) return res.status(404).json({ error: 'App not found' });
  const appId = new ObjectId(appIdText);
  const { builds, storage, queue, config } = deps;

  // Before the lock, because it reaches the network. A refusal here never creates a build, so it never counts.
  const owned = unsafe ? await apps.findOne({ _id: appId, ownerId }) : null;
  const ownedConfig = owned ? toAppConfig(owned.draft) : null;
  if (unsafe && ownedConfig) {
    try {
      if ((await unsafe(await sitesOf(ownedConfig, fetchUrl))) === 'unsafe') {
        return res.status(409).json({ error: UNSAFE_MESSAGE, reason: 'unsafe_site' });
      }
    } catch (error) {
      if (!(error instanceof UnsafeCheckUnavailable)) throw error;
      // Fails closed: no build without a safety answer.
      return res.status(503).json({ error: 'We couldn’t check the site’s safety just now. Try again in a few minutes.', reason: 'safety_check_unavailable' });
    }
  }

  const outcome = await withUserLock(deps, ownerId, async (): Promise<Outcome> => {
    const repeat = await builds.findOne({ ownerId, idempotencyKey });
    if (repeat) return { kind: 'repeat', build: repeat };

    const app = await apps.findOne({ _id: appId, ownerId });
    if (!app) return refuse(404, 'not_found', 'App not found');
    if (app.takenDown) return refuse(403, 'taken_down', `This app was taken down: ${app.takenDown.reason}`);
    const appConfig = toAppConfig(app.draft);
    if (!app.ready || !appConfig || !app.iconKey) return refuse(409, 'not_ready', 'Finish setting up the app before building it');

    const user = await auth.users.findOne({ _id: ownerId });
    if (!user?.emailVerifiedAt) return refuse(403, 'email_unverified', 'Confirm your email before building');

    const since = new Date(Date.now() - config.windowMs);
    const counted = { ownerId, createdAt: { $gte: since }, countsTowardLimit: { $ne: false } };
    if ((await builds.countDocuments(counted)) >= config.dailyLimit) {
      const oldest = await builds.findOne(counted, { sort: { createdAt: 1 } });
      const nextAllowedAt = new Date(oldest!.createdAt.getTime() + config.windowMs);
      return refuse(429, 'daily_limit', `You can start ${config.dailyLimit} builds a day`, { nextAllowedAt });
    }

    const previous = await builds.findOne({ appId }, { sort: { createdAt: -1 } });
    const id = randomUUID();
    try {
      // Inserted before the version code is taken, so a refused start never uses one up.
      await createBuild(builds, {
        _id: id,
        config: appConfig,
        plan: planOf(app),
        versionCode: 0,
        versionName: versionName ?? previous?.versionName ?? '1.0',
        iconKey: buildIconKey(id),
        appId,
        ownerId,
        idempotencyKey,
      });
    } catch (error) {
      if ((error as { code?: number }).code !== DUPLICATE_KEY) throw error;
      const running = await builds.findOne({ activeAppId: appId });
      return refuse(409, 'build_running', 'This app is already building', { buildId: running ? String(running._id) : undefined });
    }

    try {
      const counter = await apps.findOneAndUpdate(
        { _id: appId },
        { $inc: { versionCode: 1, buildCount: 1 } },
        { returnDocument: 'after' },
      );
      await builds.updateOne({ _id: id as never }, { $set: { versionCode: counter!.versionCode } });
      await storage.copy(app.iconKey, buildIconKey(id));
      await queueBuild(queue as never, id);
    } catch (error) {
      // Our failure, so it doesn't use up one of the user's builds.
      await setStatus(builds, id, 'failed', { error: (error as Error).message, failureKind: 'infra', countsTowardLimit: false });
      throw error;
    }
    return { kind: 'started', build: (await builds.findOne({ _id: id as never }))! };
  });

  if (outcome.kind === 'refused') return res.status(outcome.status).json(outcome.body);
  res.status(outcome.kind === 'started' ? 201 : 200).json(buildView(outcome.build));
};
