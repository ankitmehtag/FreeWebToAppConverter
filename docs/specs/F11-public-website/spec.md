# F11 Public website

Status: approved

## Goal
Give Free Website to App Converter a public face: a landing page that explains what it does and lets a visitor check their own site straight away, a pricing page, an FAQ, and the legal pages a public service needs before launch. These pages must be found by search engines, read well on phones and desktops, and be honest about what a wrapped website can and can't do on Google Play. The signed-in product from F08 to F10 sits behind them unchanged.

## Out of scope
- Payments and buying Premium (F14). The pricing page shows Premium as coming soon.
- Prices in other currencies (F22) and the showcase of customer apps (F21).
- A blog, help centre or documentation site.
- Analytics and advertising tags. F11 adds none.
- Production hosting and deploy, which F12 sets up. F11 makes the pages ready to serve.

## Requirements

### Pages
- R1: The site must have these public pages: Home (`/`), Pricing, FAQ, About, Contact, Terms of Service, Privacy Policy and Acceptable Use Policy. Every page must be reachable from a shared header or footer.
- R2: Home must say in its first screen what the product does and who it is for, show how it works in three steps (paste your site, set it up, install the APK), list what the app can do today, and lead to sign-up.
- R3: Pricing must show the Free plan as it really is today (APK, 3 builds a day, our watermark, links kept 7 days) and Premium as coming soon, with what it will add.
- R4: The FAQ and Home must say plainly that Google Play may reject an app that only wraps a website, and what helps (offline page, push notifications later, real value beyond the site).
- R5: A signed-in visitor opening Home must still see Home, with a link to their apps, instead of being sent away.

### URL checker
- R6: Home must have the site checker from F07: a visitor types a URL, without an account, and sees whether it is reachable, uses HTTPS, is set up for phones and can be previewed, or why it was refused, including `unsafe`.
- R7: A checked site must lead to sign-up, and after sign-up and sign-in in the same browser, the wizard must start with that URL already filled in.

### Legal
- R8: Terms, Privacy and Acceptable Use must be written from what the product really does: the data it stores (account, apps, icons, builds, logs, reports, IP-derived hashes), who processes it (Cloudflare R2, Resend, Google if Web Risk is on, MongoDB and Redis hosts), how long it is kept, and how to ask for it to be deleted.
- R9: Acceptable Use must forbid phishing, malware, scams, illegal content and apps that break Google Play policy, and say that we may take an app down and how to report one.
- R10: Sign-up must link to Terms and Privacy, and say that creating an account accepts the Terms.

### Search and sharing
- R11: Every public page must have its own title, description, canonical URL and Open Graph and Twitter card tags, and Home must have one share image.
- R12: Public pages must be served as finished HTML, so search engines and link previews see their content without running JavaScript.
- R13: The site must serve `robots.txt` and `sitemap.xml` listing the public pages only. Signed-in pages, install links and the API must be kept out of search.

### Quality
- R14: Every public page must work at 360 px and at desktop width with no horizontal scroll, meet WCAG 2.1 AA for contrast and keyboard use, and score at least 90 for performance, accessibility, best practices and SEO in Lighthouse on mobile.
- R15: Fonts must be served from our own origin, so a visit sends nothing to a third party.

## Acceptance criteria
- AC1 (R1): Given each public page, when opened signed out at 360 px and 1280 px, then it renders, has no horizontal scroll, and links to every other public page.
- AC2 (R2, R3, R4): Given Home, Pricing and FAQ, then they state the Free plan's real limits, mark Premium as coming soon, and include the Google Play warning.
- AC3 (R5): Given a signed-in user, when they open `/`, then Home shows with a link to their apps.
- AC4 (R6): Given a reachable HTTPS site, an HTTP-only site, an unreachable site and a site the checker refuses, when checked on Home without an account, then each shows its result or reason.
- AC5 (R7): Given a checked site, when the visitor signs up, confirms their email and signs in in the same browser, then the wizard opens with that URL filled in and checked.
- AC6 (R8, R9, R10): Given the legal pages, then each names the processors and stored data listed in R8, Acceptable Use lists the forbidden uses and how to report, and the sign-up page links to both and says that signing up accepts the Terms.
- AC7 (R11, R12): Given each public page fetched with `curl` (no JavaScript), then its HTML holds its heading, body text, title, description, canonical and Open Graph tags.
- AC8 (R13): Given `robots.txt` and `sitemap.xml`, then the sitemap lists exactly the public pages, and robots disallows `/my-apps`, `/install`, `/apps`, `/builds`, `/auth`, `/url` and `/reports`.
- AC9 (R14, R15): Given Lighthouse on mobile for each public page, then every category scores 90 or more, and the network log shows no request to another origin.

## Decisions
- The public pages are prerendered to static HTML when the client is built, from the same React components, and the app takes over in the browser. The signed-in pages stay client-side only.
- Fonts move from Google Fonts into the client's own files.
- With no analytics and only the sign-in cookies, which are strictly necessary, the site shows no cookie banner. One is needed only if a later feature adds optional cookies.
- The checker on Home uses the existing `/url/check` and its limit of 10 checks per 15 minutes per IP.
- The URL from Home is kept in the browser's local storage until the visitor's first app, so the account routes from F06 don't change. The wizard checks it again like any typed URL. A visitor who confirms their email on another device types the URL again.
- Premium shows "Coming soon" with no price until F14 sets one.
- The legal pages name Ankit, Gurugram (Gurgaon), Haryana, India, as the person running the service, under the laws of India, with `support@freewebsitetoappconverter.com` as the contact.
- The legal pages are drafts written from what the product really does, marked as drafts. The owner has them checked by a lawyer before launch; they are not legal advice.
- The Contact page gives an email address only, with no form.

## Open questions
None.
