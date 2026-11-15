import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import type { LookupFunction } from 'node:net';
import { isPublicAddress } from './address';
import { FetchFailure, parseUrl, pinAddress, type FetcherOptions } from './fetcher';

/** Sends a body and returns the status. */
export type Post = (url: string, body: string, headers?: Record<string, string>) => Promise<number>;

/**
 * A POST that reaches only public addresses, with the same check as the page fetcher: every address the name resolves to must be public, and the
 * connection is pinned to the one that was checked. Redirects are not followed, so a receiver can't bounce us to a private address.
 */
export const createPoster = ({
  resolve = (host) => lookup(host, { all: true, verbatim: true }),
  isAllowedAddress = isPublicAddress,
  ports = [443],
  timeoutMs = 10_000,
}: FetcherOptions = {}): Post => async (raw, body, headers = {}) => {
  const url = parseUrl(raw, undefined, ports);
  const pinned = await pinAddress(url, resolve, isAllowedAddress);
  const signal = AbortSignal.timeout(timeoutMs);
  const pin: LookupFunction = (_host, options, done) => {
    if (options.all) done(null, [pinned]);
    else done(null, pinned.address, pinned.family);
  };
  return new Promise<number>((resolveStatus, reject) => {
    const request = (url.protocol === 'https:' ? https : http).request(
      url,
      { method: 'POST', agent: false, signal, lookup: pin, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'user-agent': 'FreeWebsiteToAppConverter-Callback', ...headers } },
      (response) => {
        response.resume();
        response.on('end', () => resolveStatus(response.statusCode ?? 0));
        response.on('error', () => reject(new FetchFailure('unreachable')));
      },
    );
    request.on('error', () => reject(new FetchFailure('unreachable')));
    request.on('socket', (socket) => socket.on('error', () => undefined));
    request.end(body);
  });
};
