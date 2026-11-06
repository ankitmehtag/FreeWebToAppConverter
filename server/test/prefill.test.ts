import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { isPublicAddress } from '../src/url/address';
import { createFetcher } from '../src/url/fetcher';
import { makeHarness, signedIn } from './auth-helpers';

type Route = { type: string; body: string | Buffer };

let site: Server;
let port: number;
let routes: Record<string, Route>;
let requests: string[];
let lookups: string[];
let h: Awaited<ReturnType<typeof makeHarness>>;

const png = (size: number) =>
  sharp({ create: { width: size, height: size, channels: 4, background: { r: 10, g: 200, b: 90, alpha: 1 } } }).png().toBuffer();

beforeAll(async () => {
  site = createServer((req: IncomingMessage, res: ServerResponse) => {
    requests.push(req.url ?? '');
    const route = routes[req.url ?? ''];
    if (!route) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.setHeader('content-type', route.type);
    res.end(route.body);
  }).listen(0, '127.0.0.1');
  await new Promise((resolve) => site.once('listening', resolve));
  port = (site.address() as AddressInfo).port;

  // Only the local test server counts as public, so the real rule still refuses everything else.
  const records: Record<string, string[]> = { 'site.test': ['127.0.0.1'], 'internal.test': ['10.0.0.5'] };
  const fetchUrl = createFetcher({
    resolve: async (host) => {
      lookups.push(host);
      return (records[host] ?? []).map((address) => ({ address, family: 4 }));
    },
    isAllowedAddress: (ip) => ip === '127.0.0.1' || isPublicAddress(ip),
    ports: [80, 443, port],
  });
  h = await makeHarness({}, fetchUrl);
});

afterAll(async () => {
  site.closeAllConnections();
  site.close();
  await h.close();
});

beforeEach(() => {
  routes = {};
  requests = [];
  lookups = [];
});

const base = () => `http://site.test:${port}`;
const html = (head: string): Route => ({ type: 'text/html', body: `<!doctype html><html><head>${head}</head><body></body></html>` });

const check = async (path = '/') => {
  const user = await signedIn(h, `u${Math.random().toString(36).slice(2)}@example.com`);
  const response = await user.post('/apps/prefill', { url: `${base()}${path}` });
  expect(response.status).toBe(200);
  return response.json();
};

describe('AC11: prefill', () => {
  it('offers name, colour and icon from a manifest and theme-color', async () => {
    routes['/'] = html('<title>Home | Example</title><meta name="theme-color" content="#0f6"><link rel="manifest" href="/app.webmanifest">');
    routes['/app.webmanifest'] = {
      type: 'application/manifest+json',
      body: JSON.stringify({
        name: 'Example Shop',
        short_name: 'Shop',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-1024.png', sizes: '1024x1024', type: 'image/png' },
        ],
      }),
    };
    routes['/icon-512.png'] = { type: 'image/png', body: await png(512) };

    const offer = await check();
    expect(offer).toMatchObject({ reachable: true, appName: 'Shop', statusBarColor: '#00FF66' });
    const icon = Buffer.from(offer.icon.replace('data:image/png;base64,', ''), 'base64');
    expect((await sharp(icon).metadata()).width).toBe(512);
    expect(requests).toEqual(['/', '/app.webmanifest', '/icon-512.png']);
  });

  it('offers no icon when the site only has a 32×32 favicon', async () => {
    routes['/'] = html('<title>Tiny &amp; Co</title><link rel="icon" href="/favicon.png" sizes="32x32" type="image/png">');
    routes['/favicon.png'] = { type: 'image/png', body: await png(32) };
    const offer = await check();
    expect(offer).toEqual({ reachable: true, appName: 'Tiny & Co' });
    expect(requests).toEqual(['/']);
  });

  it('offers no icon when the declared size is a lie', async () => {
    routes['/'] = html('<link rel="icon" href="/big.png" sizes="512x512">');
    routes['/big.png'] = { type: 'image/png', body: await png(64) };
    expect((await check()).icon).toBeUndefined();
  });

  it('does not fetch a manifest or icon on a private address', async () => {
    routes['/'] = html(
      `<link rel="manifest" href="http://internal.test:${port}/manifest.json">` +
        `<link rel="icon" sizes="512x512" href="http://169.254.169.254/icon.png">`,
    );
    const offer = await check();
    expect(offer).toEqual({ reachable: true });
    expect(requests).toEqual(['/']);
    expect(lookups).toEqual(['site.test', 'internal.test']);
  });

  it('makes at most 3 fetches', async () => {
    const icons = Array.from({ length: 10 }, (_, i) => `<link rel="icon" sizes="${600 + i}x${600 + i}" href="/i${i}.png">`);
    routes['/'] = html(`<link rel="manifest" href="/m.json">${icons.join('')}`);
    routes['/m.json'] = { type: 'application/json', body: 'not json' };
    await check();
    expect(requests).toEqual(['/', '/m.json', '/i0.png']);
  });

  it('answers an unreachable site with its failure code only', async () => {
    expect(await check('/missing')).toEqual({ reachable: false, failure: 'unreachable' });
  });

  it('needs a session and a CSRF token', async () => {
    expect((await h.client().post('/apps/prefill', { url: base() })).status).toBe(401);
    const user = await signedIn(h, `u${Math.random().toString(36).slice(2)}@example.com`);
    expect((await user.post('/apps/prefill', { url: base() }, { csrf: null })).status).toBe(403);
  });
});
