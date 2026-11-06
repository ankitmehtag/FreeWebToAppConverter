import { draftSchema } from '@sitetoapk/shared';
import { checkIcon, IconError } from '@sitetoapk/shared/icon';
import { FetchFailure, type FailureCode, type FetchedPage, type FetchUrl } from '../url/fetcher';

export type Prefill =
  | { reachable: true; appName?: string; statusBarColor?: string; icon?: string }
  | { reachable: false; failure: FailureCode };

type IconCandidate = { href: string; size: number };

const MIN_ICON = 512;
const MAX_ICON = 4096;
const MAX_TAG = 2000;

const textOf = (page: FetchedPage) => {
  const encoding = page.headers['content-encoding'];
  return encoding && encoding !== 'identity' ? '' : page.body.toString('utf8');
};

/** Walks tag by tag, as the URL checker does, so a hostile page can't make a pattern run for minutes. */
const tagsNamed = (html: string, name: string) => {
  const lower = html.toLowerCase();
  const found: Record<string, string>[] = [];
  for (let from = 0; ; ) {
    const start = lower.indexOf(`<${name}`, from);
    if (start < 0) return found;
    const end = lower.indexOf('>', start);
    if (end < 0) return found;
    const tag = html.slice(start, Math.min(end, start + MAX_TAG));
    const attributes: Record<string, string> = {};
    for (const [, key, quoted, single, bare] of tag.matchAll(/([a-zA-Z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
      attributes[key!.toLowerCase()] = quoted ?? single ?? bare ?? '';
    }
    found.push(attributes);
    from = end;
  }
};

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' };
const decode = (text: string) => text.replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, name: string) => ENTITIES[name]!);

const titleOf = (html: string) => {
  const lower = html.toLowerCase();
  const start = lower.indexOf('<title');
  const open = start < 0 ? -1 : lower.indexOf('>', start);
  const end = open < 0 ? -1 : lower.indexOf('</title', open);
  return end < 0 ? undefined : decode(html.slice(open + 1, Math.min(end, open + 1 + MAX_TAG)));
};

/** Keeps a name only if the app name rule accepts it, shortened to fit. */
const appNameFrom = (...names: unknown[]) => {
  for (const name of names) {
    if (typeof name !== 'string') continue;
    const trimmed = [...name.replace(/\s+/g, ' ').trim()].slice(0, 50).join('').trim();
    if (trimmed && draftSchema.shape.appName.safeParse(trimmed).success) return trimmed;
  }
  return undefined;
};

const colourFrom = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const hex = value.trim().toUpperCase();
    if (/^#[0-9A-F]{6}$/.test(hex)) return hex;
    if (/^#[0-9A-F]{3}$/.test(hex)) return `#${[...hex.slice(1)].map((digit) => digit + digit).join('')}`;
  }
  return undefined;
};

/** The largest square size an icon declares, or 0 when it declares none. */
const declaredSize = (sizes: unknown) => {
  if (typeof sizes !== 'string') return 0;
  const squares = sizes
    .toLowerCase()
    .split(/\s+/)
    .map((size) => /^(\d+)x(\d+)$/.exec(size))
    .filter((match) => match && match[1] === match[2])
    .map((match) => Number(match![1]));
  return Math.max(0, ...squares);
};

const isPngType = (type: unknown, href: string) =>
  type === 'image/png' || (type === undefined && /\.png(?:$|[?#])/i.test(href));

/** Picks the smallest declared PNG that is big enough, so only one icon is ever fetched. */
const pickIcon = (candidates: IconCandidate[]) =>
  candidates
    .filter(({ size }) => size >= MIN_ICON && size <= MAX_ICON)
    .sort((a, b) => a.size - b.size)[0];

const resolve = (href: unknown, base: string) => {
  if (typeof href !== 'string' || !href.trim()) return undefined;
  try {
    return new URL(href.trim(), base).toString();
  } catch {
    return undefined;
  }
};

/** Fetches a secondary resource, treating any refusal or failure as "not offered". */
const tryFetch = async (fetchUrl: FetchUrl, url: string | undefined) => {
  if (!url) return undefined;
  try {
    const page = await fetchUrl(url);
    return page.status < 400 ? page : undefined;
  } catch (error) {
    if (error instanceof FetchFailure) return undefined;
    throw error;
  }
};

const parseManifest = (page: FetchedPage | undefined) => {
  if (!page) return {};
  try {
    const manifest: unknown = JSON.parse(textOf(page));
    return manifest && typeof manifest === 'object' ? (manifest as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

/** Reads the page, its manifest and one icon: at most 3 fetches, all through the safe fetcher. */
export const prefill = async (fetchUrl: FetchUrl, url: string): Promise<Prefill> => {
  let page: FetchedPage;
  try {
    page = await fetchUrl(url);
  } catch (error) {
    if (error instanceof FetchFailure) return { reachable: false, failure: error.code };
    throw error;
  }
  if (page.status >= 400) return { reachable: false, failure: 'unreachable' };

  const html = textOf(page);
  const links = tagsNamed(html, 'link');
  const metas = tagsNamed(html, 'meta');
  const hasRel = (link: Record<string, string>, rel: string) => (link.rel ?? '').toLowerCase().split(/\s+/).includes(rel);

  const manifestUrl = resolve(links.find((link) => hasRel(link, 'manifest'))?.href, page.url);
  const manifest = parseManifest(await tryFetch(fetchUrl, manifestUrl));
  const manifestBase = manifestUrl ?? page.url;

  const candidates: IconCandidate[] = [];
  for (const icon of Array.isArray(manifest.icons) ? manifest.icons : []) {
    const href = resolve(icon?.src, manifestBase);
    if (href && isPngType(icon?.type, href)) candidates.push({ href, size: declaredSize(icon?.sizes) });
  }
  for (const link of links.filter((item) => hasRel(item, 'icon') || hasRel(item, 'apple-touch-icon'))) {
    const href = resolve(link.href, page.url);
    if (href && isPngType(link.type, href)) candidates.push({ href, size: declaredSize(link.sizes) });
  }

  let icon: string | undefined;
  const chosen = pickIcon(candidates);
  const iconPage = await tryFetch(fetchUrl, chosen?.href);
  if (iconPage) {
    try {
      icon = `data:image/png;base64,${(await checkIcon(iconPage.body)).data.toString('base64')}`;
    } catch (error) {
      if (!(error instanceof IconError)) throw error;
    }
  }

  const themeMeta = metas.find((meta) => (meta.name ?? '').toLowerCase() === 'theme-color');
  return {
    reachable: true,
    appName: appNameFrom(manifest.short_name, manifest.name, titleOf(html)),
    statusBarColor: colourFrom(themeMeta?.content, manifest.theme_color),
    icon,
  };
};
