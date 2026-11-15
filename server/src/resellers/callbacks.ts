import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { Collection, Document } from 'mongodb';
import { FINAL_STATUSES } from '@sitetoapk/shared/builds';
import { buildView } from '../builds/start';
import type { Post } from '../url/poster';
import { FetchFailure } from '../url/fetcher';
import type { Resellers } from './index';

/** Waits before each retry, so a receiver that is down for a day still gets the news. */
export const BACKOFF_MS = [30_000, 2 * 60_000, 10 * 60_000, 60 * 60_000, 6 * 60 * 60_000];
const LEASE_MS = 60_000;
const BATCH = 25;

export const newSecret = () => `whsec_${randomBytes(24).toString('base64url')}`;

/** `t=<unix seconds>,v1=<hex>`: an HMAC-SHA256 of `<t>.<body>`. The receiver recomputes it and rejects an old `t`. */
export const sign = (secret: string, body: string, at: Date) => {
  const t = Math.floor(at.getTime() / 1000);
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
};

const eventOf = (status: string) => (status === 'success' ? 'build.succeeded' : status === 'failed' ? 'build.failed' : 'build.canceled');

/**
 * Turns each finished reseller build into one delivery. The build is claimed first, so two sweeps (or two servers) queue it once.
 * A reseller with no callback URL still has the build marked, so a URL set later is not sent old news.
 */
export const queueFinished = async ({ resellers, callbacks }: Resellers, builds: Collection, now = new Date()) => {
  const finished = await builds.find({ resellerId: { $exists: true }, status: { $in: FINAL_STATUSES }, callbackQueued: { $ne: true } }, { limit: BATCH }).toArray();
  let queued = 0;
  for (const build of finished) {
    const claim = await builds.updateOne({ _id: build._id, callbackQueued: { $ne: true } }, { $set: { callbackQueued: true } });
    if (!claim.matchedCount) continue;
    const reseller = await resellers.findOne({ _id: build.resellerId });
    if (!reseller?.callbackUrl) continue;
    const event = eventOf(String(build.status));
    const payload = JSON.stringify({ id: randomUUID(), event, createdAt: now.toISOString(), build: buildView(build) });
    await callbacks.insertOne({ resellerId: reseller._id, buildId: String(build._id), event, payload, status: 'pending', attempts: 0, nextAttemptAt: now, createdAt: now });
    queued += 1;
  }
  return queued;
};

/** Sends what is due. A delivery is leased before it is sent, so an overlapping sweep leaves it alone. */
export const sendDue = async ({ resellers, callbacks }: Resellers, post: Post, now = new Date()) => {
  let sent = 0;
  for (let i = 0; i < BATCH; i++) {
    const delivery = await callbacks.findOneAndUpdate({ status: 'pending', nextAttemptAt: { $lte: now } }, { $set: { nextAttemptAt: new Date(now.getTime() + LEASE_MS) } }, { sort: { nextAttemptAt: 1 } });
    if (!delivery) break;
    const reseller = await resellers.findOne({ _id: delivery.resellerId });
    const done = (fields: Document) => callbacks.updateOne({ _id: delivery._id }, { $set: fields });
    if (!reseller?.callbackUrl || !reseller.callbackSecret) {
      await done({ status: 'failed', reason: 'no_callback', finishedAt: now });
      continue;
    }
    const attempts = (delivery.attempts as number) + 1;
    let failure: string;
    try {
      const status = await post(reseller.callbackUrl as string, delivery.payload as string, { 'x-signature': sign(reseller.callbackSecret as string, delivery.payload as string, now), 'x-event': delivery.event as string });
      if (status >= 200 && status < 300) {
        await done({ status: 'delivered', attempts, deliveredAt: now });
        sent += 1;
        continue;
      }
      failure = `http_${status}`;
    } catch (error) {
      // An address we refuse to call won't improve with time.
      if (error instanceof FetchFailure && (error.code === 'blocked' || error.code === 'invalid_url')) {
        await done({ status: 'failed', attempts, reason: error.code, finishedAt: now });
        continue;
      }
      failure = error instanceof FetchFailure ? error.code : 'error';
    }
    const wait = BACKOFF_MS[attempts - 1];
    await done(wait === undefined ? { status: 'failed', attempts, reason: failure, finishedAt: now } : { attempts, reason: failure, nextAttemptAt: new Date(now.getTime() + wait) });
  }
  return sent;
};

export const runCallbacks = async (resellers: Resellers, builds: Collection, post: Post, now = new Date()) => {
  await queueFinished(resellers, builds, now);
  return sendDue(resellers, post, now);
};
