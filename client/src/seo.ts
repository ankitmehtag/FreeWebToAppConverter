import { PUBLIC_PAGES, SITE_NAME, SITE_URL, type PublicPage } from './site';

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const canonical = (path: string) => `${SITE_URL}${path === '/' ? '/' : path}`;

/** The head tags for one public page: title, description, canonical, and share cards. */
export const headTags = (page: PublicPage) => {
  const url = canonical(page.path);
  const title = escape(page.title);
  const description = escape(page.description);
  const image = `${SITE_URL}/og.png`;
  return [
    `<title>${title}</title>`,
    `<meta name="description" content="${description}" />`,
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${escape(SITE_NAME)}" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${image}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    `<meta name="twitter:image" content="${image}" />`,
  ].join('\n    ');
};

/** Lists the public pages only, so signed-in pages and install links stay out of search. */
export const sitemap = (pages: PublicPage[] = PUBLIC_PAGES) =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...pages.map((page) => `  <url><loc>${canonical(page.path)}</loc></url>`),
    '</urlset>',
    '',
  ].join('\n');

/** The output file for a public page, such as `pricing.html`, which static hosts serve at `/pricing`. */
export const fileFor = (path: string) => (path === '/' ? 'index.html' : `${path.slice(1)}.html`);
