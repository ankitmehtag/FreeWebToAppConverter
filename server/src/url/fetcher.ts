import { lookup } from 'node:dns/promises';
import http, { type IncomingHttpHeaders } from 'node:http';
import https from 'node:https';
import type { LookupFunction } from 'node:net';
import ipaddr from 'ipaddr.js';
import { isPublicAddress } from './address';

const MAX_REDIRECTS = 5;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

export type FailureCode = 'invalid_url' | 'blocked' | 'unreachable' | 'timeout' | 'too_large';

export class FetchFailure extends Error {
  constructor(readonly code: FailureCode) {
    super(code);
  }
}

type ResolvedAddress = { address: string; family: number };

export type FetcherOptions = {
  resolve?: (host: string) => Promise<ResolvedAddress[]>;
  isAllowedAddress?: (ip: string) => boolean;
  ports?: number[];
  timeoutMs?: number;
  maxBytes?: number;
};

export type FetchedPage = { url: string; status: number; headers: IncomingHttpHeaders; body: Buffer };

export type FetchUrl = (url: string) => Promise<FetchedPage>;

const parseUrl = (raw: string, base: string | undefined, ports: number[]) => {
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    throw new FetchFailure('invalid_url');
  }
  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  const scheme = url.protocol === 'http:' || url.protocol === 'https:';
  if (!scheme || url.username || url.password || !ports.includes(port)) throw new FetchFailure('blocked');
  return url;
};

/** Every address must pass, so a public record can't carry a private one past the check. */
const pinAddress = async (url: URL, resolve: NonNullable<FetcherOptions['resolve']>, isAllowed: (ip: string) => boolean) => {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = ipaddr.isValid(host)
    ? [{ address: host, family: host.includes(':') ? 6 : 4 }]
    : await resolve(host).catch(() => []);
  // IPv4 first: many hosts have no IPv6 route, and a site's IPv6 record would then make it unreachable.
  const [pinned] = [...addresses].sort((a, b) => (a.family === 4 ? 0 : 1) - (b.family === 4 ? 0 : 1));
  if (!pinned) throw new FetchFailure('unreachable');
  if (!addresses.every(({ address }) => isAllowed(address))) throw new FetchFailure('blocked');
  return pinned;
};

const send = (url: URL, pinned: ResolvedAddress, signal: AbortSignal, maxBytes: number) =>
  new Promise<FetchedPage>((resolve, reject) => {
    // Answers the connection's lookup with the checked address, so DNS is not asked again.
    const pin: LookupFunction = (_host, options, done) => {
      if (options.all) done(null, [pinned]);
      else done(null, pinned.address, pinned.family);
    };
    const client = url.protocol === 'https:' ? https : http;
    const request = client.request(
      url,
      {
        agent: false,
        signal,
        lookup: pin,
        headers: { accept: 'text/html,*/*', 'accept-encoding': 'identity', 'user-agent': 'FreeWebsiteToAppConverter-URL-Check' },
      },
      (response) => {
        const page = { url: url.toString(), status: response.statusCode ?? 0, headers: response.headers };
        if (REDIRECTS.has(page.status)) {
          request.destroy();
          resolve({ ...page, body: Buffer.alloc(0) });
          return;
        }
        const chunks: Buffer[] = [];
        let received = 0;
        response.on('data', (chunk: Buffer) => {
          received += chunk.length;
          if (received > maxBytes) {
            reject(new FetchFailure('too_large'));
            request.destroy();
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => resolve({ ...page, body: Buffer.concat(chunks) }));
        response.on('error', () => reject(new FetchFailure('unreachable')));
      },
    );
    request.on('error', () => reject(new FetchFailure('unreachable')));
    // A connection that fails after the request is done must not become an uncaught error.
    request.on('socket', (socket) => socket.on('error', () => undefined));
    request.end();
  });

export const createFetcher = ({
  resolve = (host) => lookup(host, { all: true, verbatim: true }),
  isAllowedAddress = isPublicAddress,
  ports = [80, 443],
  timeoutMs = 10_000,
  maxBytes = 2 * 1024 * 1024,
}: FetcherOptions = {}): FetchUrl => {
  const follow = async (start: string, signal: AbortSignal) => {
    let url = parseUrl(start, undefined, ports);
    for (let hop = 0; ; hop += 1) {
      const pinned = await pinAddress(url, resolve, isAllowedAddress);
      const page = await send(url, pinned, signal, maxBytes);
      const location = page.headers.location;
      if (!REDIRECTS.has(page.status) || !location) return page;
      if (hop === MAX_REDIRECTS) throw new FetchFailure('blocked');
      url = parseUrl(location, url.toString(), ports);
    }
  };

  return (start) => {
    const signal = AbortSignal.timeout(timeoutMs);
    return new Promise((resolvePage, reject) => {
      signal.addEventListener('abort', () => reject(new FetchFailure('timeout')), { once: true });
      follow(start, signal).then(resolvePage, reject);
    });
  };
};
