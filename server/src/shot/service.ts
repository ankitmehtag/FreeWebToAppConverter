import { createServer, type Server } from 'node:http';
import { FetchFailure } from '../url/fetcher';
import type { Render } from './render';

type Options = { render: Render; concurrency?: number; queue?: number; cacheSize?: number; ttlMs?: number };

/** A small service of its own, with no secrets and no database, because it runs a browser on strangers' pages. */
export const createShotService = ({ render, concurrency = 1, queue = 3, cacheSize = 50, ttlMs = 60 * 60 * 1000 }: Options): Server => {
  const cache = new Map<string, { image: Buffer; expires: number }>();
  const waiting: Array<() => void> = [];
  let running = 0;

  const slot = async () => {
    if (running < concurrency) {
      running += 1;
      return true;
    }
    if (waiting.length >= queue) return false;
    await new Promise<void>((resolve) => waiting.push(resolve));
    return true;
  };
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else running -= 1;
  };

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://shot');
    if (url.pathname === '/health') {
      res.end('ok');
      return;
    }
    const target = url.searchParams.get('url');
    if (req.method !== 'GET' || url.pathname !== '/shot' || !target || target.length > 2048) {
      res.writeHead(400).end();
      return;
    }
    const hit = cache.get(target);
    if (hit && hit.expires > Date.now()) {
      res.writeHead(200, { 'content-type': 'image/jpeg' }).end(hit.image);
      return;
    }
    if (!(await slot())) {
      res.writeHead(503, { 'content-type': 'application/json' }).end('{"error":"busy"}');
      return;
    }
    try {
      const { image } = await render(target);
      if (cache.size >= cacheSize) cache.delete(cache.keys().next().value as string);
      cache.set(target, { image, expires: Date.now() + ttlMs });
      res.writeHead(200, { 'content-type': 'image/jpeg' }).end(image);
    } catch (error) {
      if (error instanceof FetchFailure) res.writeHead(422, { 'content-type': 'application/json' }).end(JSON.stringify({ error: error.code }));
      else {
        console.error('Screenshot failed', (error as Error).message);
        res.writeHead(500, { 'content-type': 'application/json' }).end('{"error":"failed"}');
      }
    } finally {
      release();
    }
  });
};
