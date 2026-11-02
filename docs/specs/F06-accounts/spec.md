# F06 Accounts

Status: approved

## Goal
Let people create an account, prove their email, sign in with a password or Google, and recover access, on an API that resists token theft, CSRF and password guessing. Every later feature depends on knowing who is calling, so this is proven before any user data exists.

## Out of scope
- All screens. F06 is API only, and the sign-up pages arrive with the wizard (F08) and website (F11).
- Profile editing, roles beyond storing `user`, and the admin panel.
- Account deletion and data export, which need apps and builds to exist first.
- Requiring a verified email before a build (F09). F06 only records whether it is verified.
- Build, receipt and reminder emails.

## Requirements

### Sign-up and sign-in
- R1: A user must be able to register with an email and password, and sign in and out.
- R2: Emails must be normalised and unique, and a password must be 10 to 128 characters and hashed with bcrypt at cost 12.
- R3: Responses must not reveal whether an email is registered, on register, sign-in or reset, in their content or timing.

### Sessions
- R4: Sign-in must set a 15 minute access token and a rotating 30 day refresh token, both in `httpOnly`, `Secure`, `SameSite=Lax` cookies.
- R5: Refresh tokens must be stored only as hashes. Reusing an old one must revoke that whole token family.
- R6: Sign-out must revoke the session, and a password reset must revoke all of the user's sessions.
- R7: Every state-changing request using cookies must carry a valid CSRF token.

### Email links
- R8: A new account must get a verification email, and a user must be able to ask for a reset email.
- R9: Link tokens must be random, stored only as hashes, single use and short lived: 24 hours to verify, 1 hour to reset.
- R10: Mail must go through one interface, with Mailpit locally and Resend in production.

### Login protection
- R11: Failed sign-ins must be limited per account and per IP, using Redis. An account must lock after 5 failures for 15 minutes, and unlock by itself.
- R12: Lockout must not reveal whether an account exists, and must not let someone lock out a real user for ever.
- R13: Sign-up, reset and resend routes must be rate limited.

### Google sign-in
- R14: A user must be able to sign in with Google, using `state` and PKCE.
- R15: A Google sign-in with a verified email must attach to the existing account for that email, so that no duplicate is created. An unverified Google email must not attach. If the existing account's email was never verified, attaching must remove its password and sessions, because a stranger may have registered that address first.

### Hardening
- R16: The API must use Helmet, a single allowed CORS origin and zod validation on every auth route.
- R17: Passwords, tokens and hashes must never appear in logs or responses.

## Acceptance criteria
- AC1 (R1, R2): Given valid details, when a user registers and signs in, then the session works, and the stored password is a bcrypt hash at cost 12.
- AC2 (R2): Given `A@Example.com` and `a@example.com`, when both register, then one account exists. A 9 character password is rejected.
- AC3 (R3): Given a known and an unknown email, when each is used on sign-in, register and reset, then the responses match, and timing shows no usable gap across repeated samples.
- AC4 (R4): Given a sign-in, when cookies are read, then both carry `HttpOnly`, `Secure` and `SameSite=Lax`.
- AC5 (R4): Given an expired access token and a valid refresh token, when refreshed, then a new pair is issued. Given both expired, then the request is refused.
- AC6 (R5): Given a used refresh token, when reused, then it is refused, and the newer token in that family stops working too. The database holds no raw token.
- AC7 (R6): Given sign-out, when the old cookies are used, then they fail. Given a reset, then every other session fails.
- AC8 (R7): Given a cookie session, when a state-changing request has a missing or wrong CSRF token, then it is refused.
- AC9 (R8, R9): Given a verify or reset link, when used twice, the second use fails. When used past its expiry, it fails. The database holds no raw token.
- AC10 (R10): Given local Compose, when a user registers, then the mail arrives in Mailpit. Given Resend, then a real email arrives.
- AC11 (R11): Given 5 wrong passwords, when the right password follows, then it is refused. After 15 minutes it works, and the lock lifts by itself.
- AC12 (R12): Given an unknown email, when it fails 5 times, then it behaves like a real locked account. Given a locked account, then a reset link still recovers it.
- AC13 (R13): Given rapid sign-up, reset and resend calls, then the limit applies and answers 429.
- AC14 (R14): Given a wrong `state` or missing PKCE verifier, when the callback runs, then sign-in is refused. Given a valid flow, then a session is created.
- AC15 (R15): Given a password account, when Google signs in with the same verified email, then one account exists. Given an unverified Google email, then it does not attach.
- AC17 (R15): Given an unverified password account, when Google signs in with that verified email, then the old password and sessions no longer work.
- AC16 (R16, R17): Given a request with extra fields or an unknown origin, then it is refused. A search of logs after all tests finds no password or token.

## Decisions
- An unknown email runs bcrypt against a fixed dummy hash, so that both paths cost the same.
- Unverified users can sign in. Only building is blocked, in F09.
- A sign-up with a taken email answers the same way, and emails the owner instead.
- Automated tests use a fake Google server. Real Google sign-in is proven once with a real OAuth client on `localhost`.
- Mail uses a Resend test sender for now, which reaches only the owner's address. A verified domain follows the domain purchase.

## Open questions
None.
