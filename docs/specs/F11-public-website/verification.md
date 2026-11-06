# F11 Verification

Run on 2026-11-07 against the built site (`npm run build -w client`) served by `vite preview` on `localhost:5173`, which proxies the API in Compose, with mail sent to Mailpit. Browser rows ran in headless Chromium (Playwright); Lighthouse 13.6.0 ran in Chrome with its mobile settings.

Status: all criteria pass, signed off by the owner on 2026-11-07. The legal pages are drafts for a lawyer to check before launch.

| Criterion | Command or action | Real output | Result |
|---|---|---|---|
| AC1 | `npm test -w client` (public); browser at 360 px and 1280 px | All 8 public pages render signed out with a heading and footer links to every public page; no page scrolls sideways at either width; no page errors | pass |
| AC2 | `npm test -w client` (public) | Pricing states 3 builds a day, links kept 7 days and the “Made with” watermark, and Premium “Coming soon”; Home and the FAQ carry the Google Play warning | pass |
| AC3 | `npm test -w client`; browser | Signed in, `/` stays on Home with “Signed in as …” and a link to the apps | pass |
| AC4 | `npm test -w client` (public); browser | Ready, HTTP-only, unreachable, unsafe and rate-limited sites each show their result without an account; only a passing site offers “Make … an app”. Browser: `example.com` passed and showed in the live phone preview | pass |
| AC5 | `npm test -w client`; browser | Checked `example.com` on Home, chose “Make example.com an app”, signed up, confirmed from Mailpit and signed in, then landed on the new app’s wizard with `https://example.com` filled in and checked, and `com.example.app` suggested | pass |
| AC6 | `npm test -w client` (public) | Privacy names Cloudflare, Resend, Google and the database hosts, and every kind of stored data with how long it is kept; Acceptable Use lists the forbidden uses and how to report; Terms names Ankit, Gurugram (Gurgaon), Haryana, India; sign-up links Terms and Privacy and says signing up accepts the Terms | pass |
| AC7 | `npm test -w client` (seo); `curl` of each built page | Each page’s HTML holds its own `<h1>`, title, description, canonical (`https://freewebsitetoappconverter.com/…`) and Open Graph and Twitter tags, with no JavaScript run | pass |
| AC8 | `npm test -w client` (seo); `curl /sitemap.xml /robots.txt` | The sitemap lists exactly the 8 public pages; robots disallows `/my-apps`, `/install`, `/apps`, `/builds`, `/auth`, `/url` and `/reports`, and the account pages | pass |
| AC9 | Lighthouse (mobile) on all 8 pages; browser network log | Performance, Accessibility, Best Practices and SEO 100 on every page, CLS 0, LCP 0.9 s; no request to another origin while the pages load | pass |

Automated totals: `client` 73 of 73, typecheck 0 errors. The server, worker and shared code didn't change.

## Fixed during verification
- The first Lighthouse run gave Privacy 89 for performance (layout shift 0.189) and every page 96 for best practices. The cause was replacing the prerendered markup, late fonts, and a 401 from `/auth/me` in the console. Pages now hydrate, preload their fonts, and skip the session check without a session cookie.
- `vite preview` serves `/pricing` from `pricing.html`, not `pricing/index.html`, so pages are written as flat `.html` files.

## Known limits
- Production hosting (F12) must serve `/<page>` from `<page>.html` and every other path from `app.html`, and keep the API on the same origin.
- The Terms, Privacy and Acceptable Use pages are drafts and not legal advice. A lawyer checks them before launch.
- `support@freewebsitetoappconverter.com` must be able to receive mail before launch.
- A URL checked on Home reaches the wizard only in the same browser.
- Lighthouse ran against the local preview, so production numbers need checking again on the real host.
