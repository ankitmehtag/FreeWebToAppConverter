# F06 Tasks

## Design
- `server/src/auth/` holds the feature. `createApp` mounts it under `/auth` only when auth dependencies are passed, so `/health` keeps its own tests.
- An access token is a 15 minute JWT holding the session id. The session is read on every request, so that sign-out takes effect at once.
- A refresh token is `<sessionId>.<random>`. The session stores a hash of the current one, and anything else revokes it.
- The CSRF token is an HMAC of the session id, sent in a readable cookie and returned in `x-csrf-token`.
- Lockout keys use the normalised email, known or not, and a locked account stops counting, so the lock always lifts.
- Durations come from `AuthConfig`, so tests can shorten them.

## Slices
- [x] T1: Register, sign-in, dummy hash and hardening (R1, R2, R3, R16, R17)
  - Tests first: AC1, AC2, AC3, AC16
- [x] T2: Sessions, rotation and CSRF (R4, R5, R6, R7)
  - Tests first: AC4 to AC8
- [x] T3: Verify and reset links, and mail (R8, R9, R10)
  - Tests first: AC9, AC10
- [x] T4: Lockout and rate limits (R11, R12, R13)
  - Tests first: AC11, AC12, AC13
- [x] T5: Google sign-in (R14, R15)
  - Tests first against a fake server: AC14, AC15, AC17
- [x] T6: Real Resend and real Google (R10, R14)
  - Proof: AC10, AC14
