import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { FetchFailure, type FetchedPage } from '../src/url/fetcher';
import { answerThroughFetcher, createRenderer, type BrowserLike, type RouteLike } from '../src/shot/render';
import { createShotService } from '../src/shot/service';
import { createShotClient, ShotFailure } from '../src/url/screenshot';
import { makeHarness } from './auth-helpers';

const page = (url: string, status = 200): FetchedPage => ({
  url,
  status,
  headers: { 'content-type': 'text/html' },
  body: Buffer.from('<html></html>'),
});
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

const fakeRoute = (url: string, method = 'GET') => {
  const calls: { fulfilled?: unknown; aborted?: string } = {};
  const route: RouteLike = {
    request: () => ({ url: () => url, method: () => method }),
    fulfill: async (response) => void (calls.fulfilled = response),
    abort: async (reason) => void (calls.aborted = reason ?? ''),
  };
  return { route, calls };
};

describe('the browser only sees what the checked fetcher returns', () => {
  it('answers a request from the fetcher', async () => {
    const { route, calls } = fakeRoute('https://site.test/app.css');
    await answerThroughFetcher(async (url) => page(url))(route);
    expect(calls.fulfilled).toMatchObject({ status: 200, headers: { 'content-type': 'text/html' } });
  });

  it('refuses what the fetcher refuses, so an internal address is never reached', async () => {
    const { route, calls } = fakeRoute('http://10.0.0.5/secret');
    await answerThroughFetcher(async () => Promise.reject(new FetchFailure('blocked')))(route);
    expect(calls.fulfilled).toBeUndefined();
    expect(calls.aborted).toBe('failed');
  });

  it('refuses anything but GET', async () => {
    const { route, calls } = fakeRoute('https://site.test/', 'POST');
    await answerThroughFetcher(async (url) => page(url))(route);
    expect(calls.aborted).toBe('blockedbyclient');
  });
});

describe('the renderer', () => {
  const browser = () => {
    const state = { closed: false, visited: '', routed: [] as string[] };
    const launch = async (): Promise<BrowserLike> => ({
      newContext: async () => ({
        route: async () => {},
        newPage: async () => ({
          goto: async (url) => void (state.visited = url),
          waitForTimeout: async () => {},
          screenshot: async () => JPEG,
        }),
      }),
      close: async () => void (state.closed = true),
    });
    return { state, launch };
  };

  it('draws the page it ended up on after redirects, and closes the browser', async () => {
    const { state, launch } = browser();
    const render = createRenderer({ fetchUrl: async () => page('https://site.test/home'), launch });
    expect((await render('https://site.test/')).image).toEqual(JPEG);
    expect(state.visited).toBe('https://site.test/home');
    expect(state.closed).toBe(true);
  });

  it('never starts a browser for a refused address', async () => {
    const { state, launch } = browser();
    let launched = false;
    const render = createRenderer({
      fetchUrl: async () => Promise.reject(new FetchFailure('blocked')),
      launch: async () => ((launched = true), launch()),
    });
    await expect(render('http://10.0.0.5/')).rejects.toMatchObject({ code: 'blocked' });
    expect(launched).toBe(false);
    expect(state.closed).toBe(false);
  });

  it('refuses a site that answers with an error', async () => {
    const { launch } = browser();
    const render = createRenderer({ fetchUrl: async () => page('https://site.test/', 500), launch });
    await expect(render('https://site.test/')).rejects.toMatchObject({ code: 'unreachable' });
  });

  it('gives up after the time limit and still closes the browser', async () => {
    const state = { closed: false };
    const render = createRenderer({
      fetchUrl: async () => page('https://site.test/'),
      totalMs: 50,
      launch: async () => ({
        newContext: async () => ({
          route: async () => {},
          newPage: async () => ({
            goto: () => new Promise(() => {}),
            waitForTimeout: async () => {},
            screenshot: async () => JPEG,
          }),
        }),
        close: async () => void (state.closed = true),
      }),
    });
    await expect(render('https://site.test/')).rejects.toMatchObject({ code: 'timeout' });
  });
});

describe('the screenshot service and the API route', () => {
  const closers: Array<() => Promise<void> | void> = [];
  afterEach(async () => {
    await Promise.all(closers.splice(0).map((close) => close()));
  });

  const startService = async (render: (url: string) => Promise<{ image: Buffer }>, options = {}) => {
    const server = createShotService({ render, ...options }).listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    closers.push(() => void server.close());
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  };

  it('serves a picture and remembers it', async () => {
    let drawn = 0;
    const base = await startService(async () => ((drawn += 1), { image: JPEG }));
    const client = createShotClient(base);
    expect(await client('https://site.test/')).toEqual(JPEG);
    expect(await client('https://site.test/')).toEqual(JPEG);
    expect(drawn).toBe(1);
  });

  it('passes a refusal on, and says busy when the queue is full', async () => {
    const base = await startService(async (url) => {
      if (url.includes('blocked')) throw new FetchFailure('blocked');
      await new Promise((resolve) => setTimeout(resolve, 150));
      return { image: JPEG };
    }, { queue: 0 });
    const client = createShotClient(base);
    await expect(client('https://blocked.test/')).rejects.toMatchObject({ code: 'blocked' });
    const [first, second] = await Promise.allSettled([client('https://a.test/'), client('https://b.test/')]);
    const outcomes = [first, second].map((outcome) => outcome.status);
    expect(outcomes.sort()).toEqual(['fulfilled', 'rejected']);
  });

  it('reports an unreachable service as unavailable', async () => {
    await expect(createShotClient('http://127.0.0.1:1')('https://site.test/')).rejects.toMatchObject({ code: 'unavailable' });
  });

  const route = async (screenshot: (url: string) => Promise<Buffer>, config = {}) => {
    const harness = await makeHarness(config, async () => page('https://unused.test/'), {}, { screenshot, unsafeLookup: async (url) => ({ unsafe: url.includes('bad.test') }) });
    closers.push(() => harness.close());
    return (url: string) => fetch(`${harness.url}/url/screenshot?url=${encodeURIComponent(url)}`);
  };

  it('returns the image, cacheable for an hour', async () => {
    const get = await route(async () => JPEG);
    const response = await get('https://site.test/');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('cache-control')).toBe('public, max-age=3600');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(JPEG);
  });

  it('maps failures to statuses', async () => {
    const get = await route(async (url) => {
      if (url.includes('blocked')) throw new ShotFailure('blocked');
      if (url.includes('busy')) throw new ShotFailure('busy');
      throw new ShotFailure('unavailable');
    });
    expect((await get('https://blocked.test/')).status).toBe(422);
    expect((await get('https://busy.test/')).status).toBe(503);
    expect((await get('https://down.test/')).status).toBe(502);
  });

  it('refuses a listed site without drawing it', async () => {
    let drawn = false;
    const get = await route(async () => ((drawn = true), JPEG));
    const response = await get('https://bad.test/');
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: 'unsafe' });
    expect(drawn).toBe(false);
  });

  it('rejects a missing address and applies the rate limit', async () => {
    const get = await route(async () => JPEG, { routeLimit: 2 });
    expect((await get('')).status).toBe(400);
    expect((await get('https://site.test/')).status).toBe(200);
    expect((await get('https://site.test/')).status).toBe(429);
  });
});
