# Phase 1: free APK builder

Phase 1 turns a website into a signed Android APK, from sign-up to an app on a phone, for free. Every feature followed the workflow in [specs/README.md](specs/README.md): an approved spec, tests written from its acceptance criteria, and real proof recorded in its `verification.md` before the owner signed it off.

## What was built and proven

| Feature | What it gives | Proven by |
|---|---|---|
| F01 Foundation | Repo, Compose with Mongo and Redis, health check, versioned `app_config` | A clean `docker compose up` from tracked files only |
| F02 Android app | The WebView app with every behaviour toggle, hardening and safe link handling | Each toggle on the emulator and a real phone; SSL errors and `file://` blocked |
| F03 App generation | Safe file rendering, the icon pipeline and the watermark | A hostile app name builds and shows literally; fake icons refused |
| F04 Build engine | Locked-down build containers, queue, worker and reaper | Offline signed builds; no secret in image layers; no network or Docker socket inside; timeout and crash recovery |
| F05 Artifact delivery | R2 upload, signed links, checksums, 7-day expiry | Downloads match their SHA-256; expired links fail; installed on a real phone |
| F06 Accounts | Email and Google sign-in, verify and reset emails, sessions, lockout | Token reuse and missing CSRF refused; lockout recovers; one account per email |
| F07 URL safety | The fetcher that can't reach private networks, and the URL checker | Private, metadata, redirect, rebinding, IPv6, decimal and octal cases refused |
| F08 App creation | The wizard, site prefill, private icons and phone preview | Users can't reach each other's apps; package name locks; the APK asks only for internet access |
| F09 Build experience | Builds from the website, live logs, downloads and QR install | One build per double click; unique version codes; 3 a day; no secrets in logs; QR install on a real phone |
| F10 Abuse protection | Unsafe-site check (off until a key is set), reports, takedown, trusted proxy | Takedown stops every link and deletes the APK; reports reach the operations address |
| F11 Public website | Home with the site checker, pricing, FAQ, legal drafts, SEO | Lighthouse 100 in every category on every page; no third-party requests |
| F12 MVP sign-off | The end-to-end journey, the load test, the image check, the production setup | See [F12's verification](specs/F12-mvp-sign-off/verification.md) |

## Decisions that shape what ships
- Free plan only: a signed APK, 3 builds a day, a small watermark, and links kept for 7 days. Premium waits for Phase 2.
- Any website can become an app under any name. The brand denylist was built and then removed by the owner. Harmful apps are handled through the unsafe-site check, reports and takedowns.
- Spending stays as low as possible. One server will run everything except storage (R2) and email (Resend), both on their free allowances.

## What launch still needs
These are the "before launch" items in [FEATURES.md](FEATURES.md) and [deploy/README.md](../deploy/README.md):
1. A server, the domain pointed at it, and the shared signing key created and backed up.
2. The Google OAuth callback for the domain.
3. A Google Web Risk key on its free tier, to switch the unsafe-site check on.
4. A mailbox for `support@freewebsitetoappconverter.com`.
5. The load test and Lighthouse run again on the real server.

One week after going live: review the Terms, Privacy and Acceptable Use pages properly, then remove the "Draft" note from them (`client/src/pages/legal.tsx`).
