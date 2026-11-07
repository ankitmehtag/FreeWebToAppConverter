import { chromium } from 'playwright-core';
import { FetchFailure, type FetchUrl } from '../url/fetcher';

export type Shot = { image: Buffer };
export type Render = (url: string) => Promise<Shot>;

/** What the renderer needs from a request and its route, so a test can stand in for the browser. */
export type RouteLike = {
  request: () => { url: () => string; method: () => string };
  fulfill: (response: { status: number; headers: Record<string, string>; body: Buffer }) => Promise<void>;
  abort: (reason?: string) => Promise<void>;
};

type PageLike = {
  goto: (url: string, options: { waitUntil: 'load'; timeout: number }) => Promise<unknown>;
  waitForTimeout: (ms: number) => Promise<void>;
  screenshot: (options: { type: 'jpeg'; quality: number }) => Promise<Buffer>;
};

export type BrowserLike = {
  newContext: (options: Record<string, unknown>) => Promise<{
    route: (pattern: string, handler: (route: RouteLike) => Promise<void>) => Promise<void>;
    newPage: () => Promise<PageLike>;
  }>;
  close: () => Promise<void>;
};

const MOBILE_AGENT =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';

/**
 * Every request the page makes is answered here, by the checked fetcher, and never by the browser's own network.
 * A name that turns private after the check, a redirect to an internal address or a script that calls home
 * all end at the same refusal.
 */
export const answerThroughFetcher = (fetchUrl: FetchUrl) => async (route: RouteLike) => {
  const request = route.request();
  if (request.method() !== 'GET') return route.abort('blockedbyclient');
  try {
    const page = await fetchUrl(request.url());
    const type = page.headers['content-type'];
    return await route.fulfill({
      status: page.status,
      headers: type ? { 'content-type': Array.isArray(type) ? type.join(',') : type } : {},
      body: page.body,
    });
  } catch {
    return route.abort('failed').catch(() => undefined);
  }
};

export const launchChromium = (): Promise<BrowserLike> =>
  chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: [
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      // Nothing may leave the browser by itself. A page's requests are all fulfilled in-process (above),
      // so anything that gets past that, such as a WebSocket, reaches this closed port and fails.
      '--proxy-server=socks5://127.0.0.1:9',
    ],
  }) as unknown as Promise<BrowserLike>;

export type RendererOptions = {
  fetchUrl: FetchUrl;
  launch?: () => Promise<BrowserLike>;
  totalMs?: number;
};

export const createRenderer = ({ fetchUrl, launch = launchChromium, totalMs = 25_000 }: RendererOptions): Render => {
  const draw = async (url: string): Promise<Shot> => {
    // The checked fetcher decides first: a refused address never reaches the browser.
    const first = await fetchUrl(url);
    if (first.status >= 400) throw new FetchFailure('unreachable');
    const answered = new Map([[first.url, first]]);
    const browser = await launch();
    try {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
        isMobile: true,
        hasTouch: true,
        userAgent: MOBILE_AGENT,
        serviceWorkers: 'block',
        // This is a picture of the site, not the site: its own page rules don't need to hold.
        bypassCSP: true,
      });
      await context.route('**/*', answerThroughFetcher(async (target) => answered.get(target) ?? (await fetchUrl(target))));
      const page = await context.newPage();
      // A page that never finishes loading still has something to show.
      await page.goto(first.url, { waitUntil: 'load', timeout: 12_000 }).catch(() => undefined);
      await page.waitForTimeout(800);
      return { image: await page.screenshot({ type: 'jpeg', quality: 70 }) };
    } finally {
      await browser.close().catch(() => undefined);
    }
  };

  return (url) => {
    let timer: NodeJS.Timeout | undefined;
    const limit = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new FetchFailure('timeout')), totalMs);
    });
    return Promise.race([draw(url), limit]).finally(() => clearTimeout(timer));
  };
};
