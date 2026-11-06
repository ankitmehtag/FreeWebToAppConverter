# F08 App creation

Status: approved

## Goal
Let a signed-in user turn a website into a saved app record through a step-by-step wizard, with name, colour and icon prefilled from the site and a live phone preview. The record is what F09 will build, so by the end of F08 every finished app must render a valid `app_config` and icon, and no user can see or change another user's apps. This is also the first feature with screens, so it brings the React client and the sign-up and sign-in pages that F06 left out.

## Out of scope
- Starting a build, build status, My Apps download links and QR install (F09). F08 only records that a build succeeded, so the package name lock can be proven.
- The landing, pricing and legal pages, and the public URL checker on the landing page (F11).
- Push and monetization steps (F15, F16), and Premium options (F13).
- Bottom navigation, swipe navigation, custom error pages and duplicating an app.
- Camera, location and notification permissions, until a feature adds them to the Android template.
- Deleting an account, and deleting an app that has builds (F09 decides what happens to its artifacts).

## Requirements

### Client
- R1: `client/` must be a React + Vite app, served from `APP_URL`, that talks to the API with cookies and sends the CSRF token on every state-changing call.
- R2: The client must have pages for sign-up, sign-in, Google sign-in, sign-out, `/verify-email` and `/reset-password`, matching the links F06 already emails.
- R3: Wizard and app pages must need a signed-in user, and send anyone else to sign-in and back afterwards.

### App records
- R4: An app must belong to one user. Every app route must find the app by its id and its owner together, so another user's app answers 404, the same as a missing one.
- R5: A user must be able to create, list, read, update and delete their own apps. Deleting is allowed only while the app has never been built.
- R6: An app must save as a draft with any fields missing, and become `ready` only when it renders an `app_config` that passes the `shared` schema and has a valid icon.
- R7: A package name must be unique per user, and must not change after the app's first successful build.
- R8: A user may have at most 20 apps.

### Wizard
- R9: The wizard must have four steps: Basics (URL, name, package name), Branding (icon, colour), Behaviour (toggles, orientation, internal hosts) and Review.
- R10: Each step must save to the server as the user goes, so that a refresh or another device shows the same draft.
- R11: Every field must be checked in the browser and again on the server with the same `shared` zod rules, and the error shown next to its field.
- R12: The URL in Basics must go through the F07 checker, and the user must see whether it is reachable, HTTPS and mobile ready. An unreachable or non-HTTPS URL must stop the user from moving on.
- R13: A package name must be suggested from the site's host, such as `com.example.app` for `example.com`, and stay editable until it locks.

### Prefill
- R14: After the URL check, the server must read the site's title, `theme-color`, web manifest and icons through the F07 fetcher, and offer them as the app name, colour and icon. Nothing is saved until the user accepts it.
- R15: A prefilled icon must be a PNG of at least 512×512, from the manifest or the page. If none is found, the user must upload one.

### Icon upload
- R16: Uploaded and prefilled icons must pass the same checks as the F03 renderer: real PNG by magic bytes, at most 5 MB, square, 512×512 to 4096×4096, re-encoded with `sharp`.
- R17: Icons must be stored privately in R2 under the app's id, never served from a public URL, and shown to the owner only through the API.

### Permissions
- R18: The Review step must list the Android permissions the app will request, worked out from its settings. With today's template that is `INTERNET` only.

### Preview
- R19: The wizard must show a phone frame with the app's name, colour and icon. If the site allows embedding, the frame must show the live site in an iframe. If it does not, it must say so and explain that the real app is not affected.

## Acceptance criteria
- AC1 (R1, R2, R3): Given a new browser, when a user signs up, verifies the email from the link, signs out and signs in again, then each page works, and opening the wizard while signed out returns to it after sign-in.
- AC2 (R1): Given a state-changing call from the client without the CSRF header, then the API refuses it.
- AC3 (R4): Given two users, when one reads, updates or deletes the other's app by id, then each call answers 404 and nothing changes. The app list holds only the caller's apps.
- AC4 (R5, R6): Given a draft with only a URL, when saved and reloaded, then it comes back unchanged, and is not `ready`. Given every field and an icon, then it is `ready`, and its rendered config passes the `shared` schema.
- AC5 (R5): Given an app with a recorded build, when deleted, then it is refused.
- AC6 (R7): Given two apps of one user with the same package name, then the second is refused. Given a recorded successful build, when the package name is changed, then it is refused, and other fields still save.
- AC7 (R8): Given 20 apps, when a 21st is created, then it is refused.
- AC8 (R10): Given a half-filled wizard, when the page is refreshed, then the user lands on the same step with the same values.
- AC9 (R11): Given a hostile app name, a bad package name, a Java reserved word, a bad colour and extra fields, when sent straight to the API, then each is refused with a field error.
- AC10 (R12): Given an HTTP-only site and an unreachable site, when entered, then the user can't move on, and sees why.
- AC11 (R14, R15): Given a site with a manifest, `theme-color` and a 512 PNG icon, when checked, then name, colour and icon are offered. Given a site with only a 32×32 favicon, then no icon is offered. Given a manifest or icon URL pointing to a private address, then it is not fetched.
- AC12 (R16): Given a renamed JPEG, a 256×256 PNG, a non-square PNG and a 6 MB file, when uploaded, then each is refused with its reason.
- AC13 (R17): Given an icon, when its R2 object is requested without a signed-in owner, then it is refused.
- AC14 (R18): Given a finished app, when it is built by hand with the F05 script, then `aapt2 dump badging` lists exactly the permissions the Review step showed.
- AC15 (R19): Given an embeddable site, then the preview shows it live. Given a site with `X-Frame-Options: DENY`, then the preview shows the blocked notice and no blank frame.

## Decisions
- The client is React + Vite + React Router, with plain CSS. No component library, so the look stays our own.
- Drafts are loose objects on the app record, and `ready` is worked out on each save, so the wizard never has to fill fields in a fixed order.
- The package name lock is a `lockedAt` field set by the build record when a build succeeds. Until F09 exists, tests set it through a test helper.
- Prefill reads only the page and its manifest, at most 3 fetches per check, all through the F07 fetcher with its limits.
- The icon checks move from `worker/` into `shared/`, so the server and worker use one copy.

## Open questions
- Q1: The plan asks for a server-made screenshot when a site blocks embedding. A headless browser loads every image and script on the page by itself, which goes around the F07 fetcher's address checks. Proposed: F08 shows the name, icon and colour with a "your site blocks embedding" notice instead, and the screenshot waits until it can run in an isolated container with no internal network.
- Q2: The plan derives camera, location and notification permissions from features, but the template has none of those features yet. Proposed: F08 builds the permission list from settings and shows `INTERNET` only, and each later feature adds its permission to that list.
- Q3: Proposed limit of 20 apps per user, to stop abuse of storage and prefill fetches. It can be raised later.
- Q4: Can a user who has not verified their email create apps? Proposed: yes, and F09 blocks only building, as F06 already decided.
