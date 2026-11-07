import type { FailureCode } from './fetcher';

export class ShotFailure extends Error {
  constructor(readonly code: FailureCode | 'busy' | 'unavailable') {
    super(code);
  }
}

export type Screenshot = (url: string) => Promise<Buffer>;

const REFUSALS = new Set<string>(['invalid_url', 'blocked', 'unreachable', 'timeout', 'too_large']);

/** Asks the screenshot service, which runs the browser away from the API's database and keys. */
export const createShotClient =
  (baseUrl: string, timeoutMs = 35_000): Screenshot =>
  async (url) => {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/shot?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      throw new ShotFailure('unavailable');
    }
    if (response.ok) return Buffer.from(await response.arrayBuffer());
    if (response.status === 503) throw new ShotFailure('busy');
    if (response.status === 422) {
      const { error } = (await response.json().catch(() => ({}))) as { error?: string };
      if (error && REFUSALS.has(error)) throw new ShotFailure(error as FailureCode);
    }
    throw new ShotFailure('unavailable');
  };
