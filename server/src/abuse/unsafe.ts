import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';

/** Answers whether any of these URLs is on the unsafe-site list. Throws `UnsafeCheckUnavailable` when it can't tell. */
export type UnsafeChecker = (urls: string[]) => Promise<'safe' | 'unsafe'>;

/** One URL's answer from the provider, with how long a listing stays valid. */
export type UnsafeLookup = (url: string) => Promise<{ unsafe: boolean; expireTime?: string }>;

export class UnsafeCheckUnavailable extends Error {}

export const UNSAFE_MESSAGE = 'This site is on a list of unsafe sites, such as malware or phishing, so it can’t become an app.';

const THREATS = ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE'];
const LOOKUP_TIMEOUT_MS = 5000;
const CLEAN_TTL_SECONDS = 30 * 60;

/** Google's Web Risk Lookup API. The URL is Google's, never the user's, so it doesn't go through the safe fetcher. */
export const webRiskLookup =
  (apiKey: string, send: typeof fetch = fetch): UnsafeLookup =>
  async (url) => {
    const params = new URLSearchParams({ uri: url, key: apiKey });
    for (const threat of THREATS) params.append('threatTypes', threat);
    let response: Response;
    try {
      response = await send(`https://webrisk.googleapis.com/v1/uris:search?${params}`, { signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) });
    } catch {
      throw new UnsafeCheckUnavailable('Web Risk could not be reached');
    }
    if (!response.ok) throw new UnsafeCheckUnavailable(`Web Risk answered ${response.status}`);
    const body = (await response.json()) as { threat?: { expireTime?: string } };
    return body.threat ? { unsafe: true, expireTime: body.threat.expireTime } : { unsafe: false };
  };

/** Wraps a lookup with a Redis cache: a listing until Google says it expires, a clean answer for 30 minutes. */
export const createUnsafeChecker =
  (redis: Redis, lookup: UnsafeLookup): UnsafeChecker =>
  async (urls) => {
    for (const url of new Set(urls)) {
      const key = `unsafe:${createHash('sha256').update(url).digest('hex')}`;
      let verdict = await redis.get(key);
      if (!verdict) {
        let answer: Awaited<ReturnType<UnsafeLookup>>;
        try {
          answer = await lookup(url);
        } catch (error) {
          throw error instanceof UnsafeCheckUnavailable ? error : new UnsafeCheckUnavailable((error as Error).message);
        }
        verdict = answer.unsafe ? 'unsafe' : 'safe';
        const listedFor = answer.expireTime ? Math.ceil((Date.parse(answer.expireTime) - Date.now()) / 1000) : 0;
        await redis.set(key, verdict, 'EX', listedFor > 0 ? listedFor : CLEAN_TTL_SECONDS);
      }
      if (verdict === 'unsafe') return 'unsafe';
    }
    return 'safe';
  };

/** A host from `internalHosts` as a URL the list can judge. */
export const hostUrl = (host: string) => `https://${host}/`;
