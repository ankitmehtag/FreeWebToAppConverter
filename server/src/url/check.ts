import type { IncomingHttpHeaders } from 'node:http';
import { FetchFailure, type FailureCode, type FetchedPage, type FetchUrl } from './fetcher';

export type UrlCheck =
  | { reachable: true; https: boolean; mobileReady: boolean | 'unknown'; embeddable: boolean }
  | { reachable: false; failure: FailureCode };

const headerText = (value: string | string[] | undefined) => (Array.isArray(value) ? value.join(',') : (value ?? ''));

/** Walks tag by tag, because a pattern across a hostile page could run for minutes. */
const hasViewportTag = (html: string) => {
  let from = 0;
  for (;;) {
    const start = html.indexOf('<meta', from);
    if (start < 0) return false;
    const end = html.indexOf('>', start);
    if (end < 0) return false;
    if (/\bname\s*=\s*["']?viewport\b/.test(html.slice(start, end))) return true;
    from = end;
  }
};

const isMobileReady = ({ headers, body }: FetchedPage) => {
  if (headers['content-encoding'] && headers['content-encoding'] !== 'identity') return 'unknown';
  return hasViewportTag(body.toString('utf8').toLowerCase());
};

const frameAncestors = (headers: IncomingHttpHeaders) =>
  headerText(headers['content-security-policy'])
    .toLowerCase()
    .split(/[;,]/)
    .map((directive) => directive.trim().split(/\s+/))
    .filter(([name]) => name === 'frame-ancestors')
    .map(([, ...sources]) => sources);

const isEmbeddable = (headers: IncomingHttpHeaders) => {
  const policies = frameAncestors(headers);
  // Browsers ignore X-Frame-Options when frame-ancestors is present.
  if (policies.length > 0) return policies.every((sources) => sources.includes('*') || sources.includes('https:'));
  return !headers['x-frame-options'];
};

export const checkUrl = async (fetchUrl: FetchUrl, url: string): Promise<UrlCheck> => {
  try {
    const page = await fetchUrl(url);
    if (page.status >= 400) return { reachable: false, failure: 'unreachable' };
    return {
      reachable: true,
      https: page.url.startsWith('https:'),
      mobileReady: isMobileReady(page),
      embeddable: isEmbeddable(page.headers),
    };
  } catch (error) {
    if (error instanceof FetchFailure) return { reachable: false, failure: error.code };
    throw error;
  }
};
