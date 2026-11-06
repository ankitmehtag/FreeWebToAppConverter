import cookieParser from 'cookie-parser';
import express, { Router, type Request, type Response } from 'express';
import type { ObjectId } from 'mongodb';
import { FINAL_STATUSES, logChannel, logLinesKey, type BuildEvent, type LogLine } from '@sitetoapk/shared/builds';
import type { Auth } from '../auth';
import { allowOrigin, invalid } from '../auth/routes';
import { requireCsrf, requireSession } from '../auth/session';
import type { Builds } from './index';
import { createInstallLink } from './install';
import { buildView } from './start';

export const DOWNLOAD_LINK_SECONDS = 60 * 60;
const PING_MS = 15_000;

const ownedBuild = (deps: Builds, req: Request, res: Response) => {
  const id = String(req.params.id);
  // Build ids are UUIDs. Anything else, or another user's build, gets the same 404.
  if (!/^[0-9a-f-]{36}$/.test(id)) return Promise.resolve(null);
  return deps.builds.findOne({ _id: id as never, ownerId: res.locals.session.userId as ObjectId });
};

const notFound = (res: Response) => res.status(404).json({ error: 'Build not found' });

/** The lines so far: the kept log once it exists, otherwise the live list in Redis. */
const linesSoFar = async ({ buildLogs, redis }: Builds, id: string): Promise<LogLine[]> => {
  const stored = await buildLogs.findOne({ _id: id as never });
  if (stored) return stored.lines;
  return (await redis.lrange(logLinesKey(id), 0, -1)).map((entry) => JSON.parse(entry));
};

/** Answers the download link, or why there is none. Shared with the install routes. */
type Link = { url: string } | { url?: undefined; status: number; error: string };

export const downloadLink = async (deps: Builds, build: { status: string; artifactKey?: string; expiresAt?: Date }): Promise<Link> => {
  if (build.status !== 'success') return { status: 409, error: 'This build has no APK' };
  if (!build.artifactKey || !build.expiresAt || build.expiresAt <= new Date()) {
    return { status: 410, error: 'This build has expired. Start a new build to get the app again.' };
  }
  return { url: await deps.storage.signedLink(build.artifactKey, DOWNLOAD_LINK_SECONDS) };
};

export const buildsRouter = (auth: Auth, deps: Builds) => {
  const router = Router();
  router.use(allowOrigin(auth), cookieParser(), express.json({ limit: '10kb' }), requireSession(auth));

  router.get('/:id', async (req, res) => {
    const build = await ownedBuild(deps, req, res);
    if (!build) return notFound(res);
    res.json(buildView(build));
  });

  router.post('/:id/install-link', requireCsrf(auth), async (req, res) => {
    const build = await ownedBuild(deps, req, res);
    if (!build) return notFound(res);
    const link = await downloadLink(deps, build as never);
    if (link.url === undefined) return res.status(link.status).json({ error: link.error });
    res.status(201).json(await createInstallLink(auth, deps, build));
  });

  router.get('/:id/download', async (req, res) => {
    const build = await ownedBuild(deps, req, res);
    if (!build) return notFound(res);
    const link = await downloadLink(deps, build as never);
    if (link.url !== undefined) return res.redirect(302, link.url);
    res.status(link.status).json({ error: link.error });
  });

  /** Sends the status and every line so far, then follows the build live until it ends. */
  router.get('/:id/events', async (req, res) => {
    const build = await ownedBuild(deps, req, res);
    if (!build) return notFound(res);
    const id = String(build._id);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const send = (event: BuildEvent) => res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);

    let lastLine = 0;
    let closed = false;
    let timer: NodeJS.Timeout | undefined;
    let stop = () => {};
    const close = () => {
      if (closed) return;
      closed = true;
      stop();
      clearInterval(timer);
      res.end();
    };
    const deliver = (event: BuildEvent) => {
      if (closed) return;
      if (event.type === 'line') {
        if (event.n <= lastLine) return;
        lastLine = event.n;
      }
      send(event);
      if (event.type === 'status' && FINAL_STATUSES.includes(event.status)) {
        res.write('event: end\ndata: {}\n\n');
        close();
      }
    };
    req.on('close', close);

    // Listening starts before the history is read, so nothing published in between is lost.
    const early: BuildEvent[] = [];
    let live = false;
    stop = await deps.hub.listen(logChannel(id), (message) => {
      const event = JSON.parse(message) as BuildEvent;
      if (live) deliver(event);
      else early.push(event);
    });

    const final = FINAL_STATUSES.includes(build.status);
    if (!final) send({ type: 'status', status: build.status });
    for (const line of await linesSoFar(deps, id)) deliver({ type: 'line', ...line });
    if (final) return deliver({ type: 'status', status: build.status, failureKind: build.failureKind });

    live = true;
    early.forEach(deliver);
    timer = setInterval(async () => {
      res.write(': ping\n\n');
      const now = await deps.builds.findOne({ _id: id as never }).catch(() => null);
      if (now && FINAL_STATUSES.includes(now.status)) {
        for (const line of await linesSoFar(deps, id)) deliver({ type: 'line', ...line });
        deliver({ type: 'status', status: now.status, failureKind: now.failureKind });
      }
    }, deps.config.pollMs ?? PING_MS);
  });

  router.use(invalid);
  return router;
};
