# F11 Tasks

## Design
- The route tree moves out of `main.tsx` into `src/routes.tsx`, so the browser (`BrowserRouter`) and the prerender (`StaticRouter`) render the same pages.
- `Layout` gains public navigation (Pricing, FAQ, then Sign in and Get started, or Your apps when signed in) and a footer linking every public page. Home stops redirecting: Google sign-in lands on Home, which links to the user's apps.
- `src/site.ts` holds the site's address (`https://freewebsitetoappconverter.com`), the public routes with their title and description, and the operator details for the legal pages. `usePageMeta` sets the title and description in the browser; the prerender writes the same into each page's HTML.
- Prerender: `npm run build -w client` runs the normal Vite build, then a server build of `src/entry-server.tsx`, then `scripts/prerender.mjs`, which renders each public route with `renderToString` and writes `dist/<route>.html` with its head tags, which static hosts serve at `/<route>` (nginx `try_files $uri $uri.html`). It also writes `dist/app.html`, an empty shell that F12 serves for every other path, and `sitemap.xml`. Each prerendered page marks its root with `data-path`, and the browser hydrates it when the path matches, so nothing moves; every other page starts from the empty `app.html` with `createRoot`. The two text fonts are preloaded. The session check skips `/auth/me` when there is no CSRF cookie, so a visitor makes no request and logs no 401.
- Fonts come from `@fontsource` packages, bundled by Vite into our own files.
- The share image `public/og.png` (1200 × 630) is drawn once by `scripts/og-image.mjs` with `sharp` and committed. `public/robots.txt` and `public/sitemap.xml` are static files.
- The site checker on Home posts to `/url/check`. "Make it an app" stores the URL in local storage under `pending-site` and opens sign-up, or the apps page when signed in. The apps page turns a pending site into a new app and opens its wizard at `/my-apps/:id/basics?site=…`, and the wizard fills in and checks that URL once.
- Legal pages are React pages with the text in `src/pages/legal.tsx`, each marked as a draft with its date.

## Slices
- [x] T1: Public shell: shared routes, header and footer, Home, Pricing, FAQ, About and Contact, signed-in Home, self-hosted fonts (R1, R2, R3, R4, R5, R15)
  - Tests first: AC1 (component part), AC2, AC3
- [x] T2: Site checker on Home and the hand-off to the wizard (R6, R7)
  - Tests first: AC4, AC5
- [x] T3: Legal drafts and sign-up consent (R8, R9, R10)
  - Tests first: AC6
- [x] T4: Prerender, page meta, share image, robots and sitemap (R11, R12, R13)
  - Tests first: AC7, AC8
- [x] T5: Browser and Lighthouse proof (R14, R15)
  - Proof: AC1, AC5, AC9
