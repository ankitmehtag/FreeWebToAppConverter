// Writes each public page as finished HTML, so search engines and link previews see its content.
// Runs after the browser build and the server build of src/entry-server.tsx.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const { render, headTags, sitemap, fileFor, PUBLIC_PAGES } = await import(pathToFileURL(join(root, 'dist-server', 'entry-server.js')).href);

// Preloads the two text fonts, so text doesn't move when they arrive.
const fonts = (await readdir(join(dist, 'assets'))).filter((file) => /^(bricolage-grotesque|figtree)-latin-wght-normal-.*\.woff2$/.test(file));
const preload = fonts.map((file) => `<link rel="preload" href="/assets/${file}" as="font" type="font/woff2" crossorigin />`).join('\n    ');
const template = (await readFile(join(dist, 'index.html'), 'utf8')).replace('<!--head:start-->', `${preload}\n    <!--head:start-->`);
const HEAD = /<!--head:start-->[\s\S]*?<!--head:end-->/;
if (!HEAD.test(template) || !template.includes('<!--app-->')) throw new Error('index.html is missing its prerender markers');

// The signed-in pages are rendered in the browser only, from a shell with no page content.
await writeFile(join(dist, 'app.html'), template.replace(HEAD, '<title>Free Website to App Converter</title>').replace('<!--app-->', ''));

for (const page of PUBLIC_PAGES) {
  const html = template
    .replace(HEAD, headTags(page))
    .replace('<div id="root"><!--app-->', `<div id="root" data-path="${page.path}">${render(page.path)}`);
  const file = join(dist, fileFor(page.path));
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, html);
  console.log(`prerendered ${page.path}`);
}
await writeFile(join(dist, 'sitemap.xml'), sitemap());
