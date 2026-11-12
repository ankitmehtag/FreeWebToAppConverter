# F17 Tasks

## Design
- `server/src/admin/`: `totp.ts` (RFC 6238, no new dependency), `index.ts` (audit log, admin state), `routes.ts` (the `/admin` API).
- Gate order on every route: session, then `ADMIN_EMAILS`, then 2FA on this session. Anything that fails the first two is a plain 404.
- The 2FA secret is stored AES-GCM encrypted. A session is marked `adminVerifiedAt` after a correct code; each code step works once.
- Audit log is `adminAudit`: the API only inserts and reads. No update or delete route exists.
- Disabling a user sets `disabledAt` and revokes sessions; login refuses disabled users.
- Retry works on failed builds; cancel works on queued builds only (a running build is never killed halfway).
- Client: one `/admin` page with tabs (Overview, Users, Apps, Builds, Orders, Audit), `noindex`.

## Slices
- [ ] T1: TOTP and admin gate with 2FA (R1, R2, R9)
  - Tests first: AC1, AC2
- [ ] T2: Overview, lists and details (R3, R4, R5, R8)
  - Tests first: AC3, AC4, AC8
- [ ] T3: Actions and audit log (R6, R7)
  - Tests first: AC5, AC6, AC7
- [ ] T4: Admin page in the client (R3-R7)
- [ ] T5: Deploy, enroll 2FA, verification
