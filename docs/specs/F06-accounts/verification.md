# F06 Verification

Run on 2026-11-02. Automated tests used Mongo and Redis in Compose, with a fake mailer and a fake Google server. The Mailpit row ran against the real API in Compose.

Status: all criteria pass, signed off by the owner on 2026-11-03.

| Criterion | Command or action | Real output | Result |
|---|---|---|---|
| AC1 | `npm test -w server` | Session works; stored password is a bcrypt hash at cost 12 | pass |
| AC2 | `npm test -w server` | One account for two spellings, including two registrations at once; 9 characters rejected | pass |
| AC3 | `npm test -w server` | Sign-in, register and reset answer the same for known and unknown emails; timing test passes | pass |
| AC4 | `npm test -w server` | Both cookies carry `HttpOnly`, `Secure` and `SameSite=Lax` | pass |
| AC5 | `npm test -w server` | New pair issued after the access token expires; refused when both have | pass |
| AC6 | `npm test -w server` | Reuse revokes the family; no raw token stored | pass |
| AC7 | `npm test -w server` | Old cookies fail after sign-out; a reset ends every session | pass |
| AC8 | `npm test -w server` | `/auth/logout`, `/auth/refresh` and `/auth/email/resend` refuse a missing token; another session's token is refused | pass |
| AC9 | `npm test -w server` | Verify and reset links work once; expired links and wrong kinds refused; no raw token stored | pass |
| AC10 (Mailpit) | Compose: `POST /auth/register`, then searched the Mailpit API | 202; 1 mail, `Verify your email`, from `noreply@localhost` | pass |
| AC10 (Resend) | 2026-11-03, Compose with a real `RESEND_API_KEY`: `POST /auth/register` with the owner's address | 202; no `Sending mail failed` in the API log; the owner confirmed `Verify your email` arrived in the inbox | pass |
| AC11 | `npm test -w server` | Right password refused while locked; lock lifts by itself and is not extended by further tries; per IP limit applies | pass |
| AC12 | `npm test -w server` | Unknown email behaves like a locked account; a reset link recovers a locked account | pass |
| AC13 | `npm test -w server` | Rapid sign-up, reset and resend calls answer 429 | pass |
| AC14 (fake) | `npm test -w server` | Wrong `state`, no flow, wrong PKCE verifier, wrong nonce and forged audience refused; valid flow creates a session | pass |
| AC14 (real) | 2026-11-03, signed in at `http://localhost:3000/auth/google` with a real OAuth client, then read Mongo | 1 account for the email, Google linked, email verified, password removed (the account was unverified, so R15 applied), 2 unrevoked sessions | pass |
| AC15 | `npm test -w server` | One account after linking; an unverified Google email does not attach | pass |
| AC16 | `npm test -w server`; searched the verbose test output and API log for passwords, bcrypt hashes and JWTs | Extra fields, operators and unknown origins refused; 0 matches in both | pass |
| AC17 | `npm test -w server` | Old password and sessions stop working | pass |

Automated totals: `shared` 42 of 42, `server` 50 of 50, `worker` 90 of 90, typecheck 0 errors. All rerun on 2026-11-03 with the same totals.

## Known limits
- `SeaweedFS` runs out of volume slots after about 30 test buckets, because each one takes 7 slots and the tests leave them behind. Storage tests then fail with `InternalError`, and the log shows `0 node candidates`. Delete the `test-*` collections with `weed shell`, which is what this run needed.

Sign-off: owner, 2026-11-03
