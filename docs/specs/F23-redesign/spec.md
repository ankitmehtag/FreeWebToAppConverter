# F23 Redesign: navy and electric blue SaaS look

Status: approved (owner said "krdo", 2026-11-13)

Source design: the owner's Claude Design canvas, https://claude.ai/artifact/5f3pwYbwatmZAGaiy4Wzwq
(boards: Homepage, Dashboard, Convert flow, Features piece). The canvas is a reference only. Real copy, prices and limits
come from the product and the backend, never from the canvas placeholders.

## Goal
Replace the teal and marigold look with a premium SaaS look (white, deep navy, electric blue, Inter) on every screen,
without changing behaviour, routes, API calls or copy that the product already owns.

## Out of scope
- New features, new routes, new API fields.
- Invented stats, prices or limits. Pricing stays as F11/F14 define it.
- A dark mode.

## Stack (unchanged)
React 19 + react-router 8 + Vite (client), Express + Node (server), shared types in `shared`.
Styling is plain CSS in `client/src/styles.css`, driven by tokens in `:root`. No CSS framework.

## Design tokens (one place to change the whole look: `:root` in `client/src/styles.css`)
| Token | Value | Use |
|---|---|---|
| `--ink` | `#0B1437` | text, dark bands, dark buttons |
| `--muted` | `#4A5778` | secondary text |
| `--surface` | `#F6F8FC` | page background |
| `--panel` | `#FFFFFF` | cards, bars |
| `--line` | `#E4E9F2` | borders |
| `--teal` (now blue) | `#2F5BFF` | primary buttons, accents |
| `--teal-deep` (now deep blue) | `#1E45E6` | hover, links |
| `--marigold` (now blue tint) | `#2F5BFF` | focus ring |
| `--marigold-soft` (now pale blue) | `#E8EEFF` | chips, soft fills |
| `--display`, `--body` | Inter Variable | all text |
| `--mono` | JetBrains Mono | URLs and hashes only |

Token names are kept (teal, marigold) so no other rule had to change; the names are historic, the values are the new look.
Status colours: success `#0B6B42` on `#E3F6EC`, failure `#A8271C` on `#FDE8E6`, building `#1E45E6` on `#E8EEFF`.

## Screens
Each screen lists the file that renders it, the CSS block that styles it, and what the design asks for.

### S1 Top bar and footer (every page)
Files: `client/src/layout.tsx`; CSS "Top bar".
Sticky white bar, wordmark left, links and a blue Get started button right. Footer unchanged in content.

### S2 Home
Files: `client/src/pages/home.tsx`; CSS "Home, redesign v3" (end of `styles.css`).
1. Hero: pale gradient, large heading with the blue accent, address-bar checker with a blue button, three trust chips, a tilted phone preview.
2. How it works: three cards.
3. What your app does: six cards (existing copy).
4. Why: navy band comparing agency development with this product.
5. Google Play note (existing copy).
6. Closing: rounded navy band with the CTA.
Behaviour (checker, preview, sign-up hand-off) is untouched.

### S3 Dashboard (Your apps)
Files: `client/src/pages/apps.tsx`; CSS "Apps list".
Rows become white cards with status pills (blue building, green ready, red failed). Counts and statuses come from the API as before.

### S4 Build page (progress, success, failure)
Files: `client/src/pages/build.tsx`; CSS "Builds".
Five-stage progress, building, ready (download) and failed states take the new tokens and the pill colours above. A download is shown only for a successful build (existing rule).

### S5 Wizard, account, admin, info and legal pages
Files: `wizard.tsx`, `account.tsx`, `admin.tsx`, `info.tsx`, `legal.tsx`, panels.
Restyled only through the tokens. No markup change.

## Requirements
- R1 All colours come from tokens; no teal or marigold hex remains outside `:root`.
- R2 Inter is the only text font; it is bundled (no external font request).
- R3 Contrast: body text 4.5:1, large text 3:1, on every new background.
- R4 Touch targets at least 44px; visible focus ring; `prefers-reduced-motion` respected.
- R5 No horizontal scroll at 360px width.
- R6 Existing tests, typecheck and the prerender build pass.

## Acceptance criteria
- AC1 Home shows the six sections above in order.
- AC2 Status pills use the colours in the token table.
- AC3 `npm run typecheck`, `npm test` and `npm run build` pass in `client`.
- AC4 Lighthouse accessibility stays at 97 or above on Home.
- AC5 Owner looks at S1 to S4 on desktop and phone and signs off.

## How to change things later
- Whole palette or font: edit `:root`.
- One screen: edit its file and the CSS block named in its section above, nothing else.
- A new screen: add a section here first, then build it.
