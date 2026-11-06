import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonical, fileFor, headTags, sitemap } from '../src/seo';
import { PUBLIC_PAGES } from '../src/site';

describe('F11 AC7: head tags', () => {
  it.each(PUBLIC_PAGES)('$path has its own title, description, canonical and share tags', (page) => {
    const tags = headTags(page);
    expect(tags).toContain(`<link rel="canonical" href="${canonical(page.path)}" />`);
    for (const name of ['og:title', 'og:description', 'og:url', 'og:image', 'twitter:card', 'twitter:image']) expect(tags).toContain(name);
    expect(tags).toContain('<title>');
    expect(tags).toContain('name="description"');
  });

  it('gives every page a different title and description', () => {
    expect(new Set(PUBLIC_PAGES.map((page) => page.title)).size).toBe(PUBLIC_PAGES.length);
    expect(new Set(PUBLIC_PAGES.map((page) => page.description)).size).toBe(PUBLIC_PAGES.length);
  });

  it('escapes text, so a quote can’t break out of an attribute', () => {
    expect(headTags({ path: '/x', title: 'A "quoted" <b>', description: 'd&d' })).toContain('content="A &quot;quoted&quot; &lt;b&gt;"');
  });

  it('writes each page to its own folder', () => {
    expect(fileFor('/')).toBe('index.html');
    expect(fileFor('/pricing')).toBe('pricing.html');
  });
});

describe('F11 AC8: sitemap and robots', () => {
  it('lists exactly the public pages', () => {
    const urls = [...sitemap().matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]);
    expect(urls).toEqual(PUBLIC_PAGES.map((page) => canonical(page.path)));
  });

  it('keeps signed-in pages, install links and the API out of search', () => {
    // Tests run from the client folder; jsdom gives import.meta.url an http address.
    const robots = readFileSync(join(process.cwd(), 'public', 'robots.txt'), 'utf8');
    for (const path of ['/my-apps', '/install', '/apps', '/builds', '/auth', '/url', '/reports']) {
      expect(robots).toContain(`Disallow: ${path}\n`);
    }
    for (const page of PUBLIC_PAGES.filter((item) => item.path !== '/')) expect(robots).not.toContain(`Disallow: ${page.path}\n`);
    expect(robots).toContain('Sitemap: https://freewebsitetoappconverter.com/sitemap.xml');
  });
});
