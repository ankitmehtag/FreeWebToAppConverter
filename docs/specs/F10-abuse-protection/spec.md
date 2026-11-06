# F10 Abuse protection

Status: approved

## Goal
Stop the builder being used to wrap phishing and malware sites, give anyone a way to report an app, and give us a way to take one down. F09 lets a stranger go from sign-up to an installed APK, so these checks must sit in front of it before launch. F10 also fixes how the server reads a visitor's IP behind a proxy, because every per-IP limit, including the new ones here, depends on it.

## Out of scope
- The admin panel and audit log screens (F17). F10 takes apps down with a command, and records each takedown so F17 can show it.
- Proving ownership of a domain with a meta tag or DNS record (F19). Until then a blocked brand can't be unblocked by its owner through the product.
- Blocking or banning user accounts, and CAPTCHA.
- Re-checking apps that were already built, on a schedule.
- Play Store listing advice in the UI and docs (F11).

## Requirements

### Unsafe sites
- R1: A site must be checked against an unsafe-site list (malware, social engineering, unwanted software) before it is accepted in the wizard, and again when a build starts. The list is reached through one provider interface, and the check is off until a provider key is set.
- R2: The check must cover the start URL, the final URL after redirects, and every host in `internalHosts`.
- R3: A listed site must be refused with a plain reason. At build start the refusal must not count toward the user's 3 builds a day.
- R4: Results must be cached in Redis for the time the lookup service allows, so repeat checks don't call it again.
- R5: The `/url/check` answer gains the failure `unsafe`, so the landing page (F11) refuses the same sites.

### Brand lookalikes
Removed by the owner on 2026-11-07 (R6 to R9): anyone may make an app from any website, including well-known brands, under any name. Wrapped sites are still checked against the unsafe-site list, and harmful apps are handled through reports and takedowns.

### Reports
- R10: Anyone must be able to report an app from its install page, without an account, giving a reason (phishing, malware, impersonation, other) and optional details and contact email.
- R11: Reports must be stored in `abuseReports`, linked to the app and build, and each report must email the operations address.
- R12: Reporting must be limited per IP, and the same visitor reporting the same app again must not create a new report.

### Takedown
- R13: An operator must be able to take an app down with a command, giving a reason.
- R14: A takedown must delete every APK of the app, which also stops every download and install link (F05, F09), refuse new builds and edits, and show the owner that the app was taken down and why.
- R15: Each takedown must be stored with who ran it, when, the reason and what was deleted, so F17 can show it later. A takedown must be reversible for new builds, but deleted APKs stay deleted.

### Visitor IP
- R16: The server must read the visitor's IP from a configured, trusted proxy only, so per-IP limits count each visitor separately behind a proxy and can't be dodged by a forged header.

## Acceptance criteria
- AC1 (R1, R3): Given a test provider that lists Google's test phishing and malware URLs, when entered in the wizard or used at build start, then each is refused with its reason, and the build start doesn't count toward the daily limit.
- AC2 (R2): Given a safe start URL that redirects to a test unsafe URL, and a safe app with a test unsafe host in `internalHosts`, then both are refused.
- AC3 (R4): Given the same URL checked twice, then the lookup service is called once.
- AC4 (R5): Given a test unsafe URL, when sent to `/url/check`, then it answers `unsafe` and nothing else.
- AC5, AC6: removed with R6 to R9.
- AC7 (R10, R11): Given an install page, when a visitor reports it without signing in, then the report is stored against the app and build, and the operations address gets an email.
- AC8 (R12): Given 11 reports from one IP, then the extra one answers 429. Given the same visitor reporting the same app twice, then one report exists.
- AC9 (R13, R14): Given a built app with a live install link, when it is taken down, then its download and install links fail, its APK objects are gone, a new build and an edit are refused, and the owner sees the reason.
- AC10 (R15): Given a takedown and its reversal, then both are stored with operator, time and reason, a new build is allowed again, and the deleted APKs stay deleted.
- AC11 (R16): Given requests through the trusted proxy from two visitors, then each has its own limit. Given a forged `X-Forwarded-For` sent straight to the server, then it is ignored.

## Decisions
- Unsafe-site checks fail closed at build start: if the lookup service can't be reached, the build is refused with "try again later" and doesn't count. In the wizard they fail open with a note, so an outage doesn't stop people setting up.
- Takedown runs as a server script, `npm run takedown -w server`, until F17 gives it a screen.
- The trusted proxy is set with a `TRUST_PROXY` setting, empty by default, which reads no forwarded headers at all.
- The provider is Google's Web Risk Lookup API, read with a `WEB_RISK_API_KEY` setting. Google's free Safe Browsing API is for non-commercial use, and the abuse.ch feeds may need a paid plan for commercial use. The owner chose on 2026-11-07 not to pay for anything yet, so F10 ships with the check off, tested against a fake provider, and Web Risk's free monthly allowance is switched on before launch.
- Report emails go to a `REPORTS_EMAIL` setting, such as `abuse@freewebsitetoappconverter.com`.
- The brand denylist was built, then removed by the owner on 2026-11-07 so that any website can become an app.
- A takedown stops only the reported app. Banning accounts waits for F17.

## Open questions
None.
