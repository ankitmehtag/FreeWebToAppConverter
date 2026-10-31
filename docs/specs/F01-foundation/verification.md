# F01 Verification

Run on 2026-11-01 with Docker 29.9.2 on Apple Silicon. Automated tests and typecheck ran on Node 22.23.4 inside `node:22-slim`.

| Criterion | Command or action | Real output | Result |
|---|---|---|---|
| AC1 | `ls -d client server worker android-template shared` in a copy holding only files git would track | All five folders listed | pass |
| AC2 | `git check-ignore -v .env`; read `.env.example` | `.gitignore:2:.env`; none of the 28 trackable files is `.env`; `.env.example` holds only local Compose URLs and `PORT` | pass |
| AC3 | Removed project images, volumes and build cache, then `docker compose up -d --build --wait`. Repeated from the tracked-files copy with `build --no-cache api` | `api`, `mongo` and `redis` all healthy, both times | pass |
| AC4 | Wrote a Mongo record and a Redis key, ran `docker compose down` and `up -d --wait`, then read both | `{ marker: 'ac4' }` and `persisted` | pass |
| AC5 | `curl /health` with all services up | `{"status":"ok","mongo":"up","redis":"up"}` HTTP 200 | pass |
| AC6 | `docker compose stop redis`, then `curl /health` | `{"status":"degraded","mongo":"up","redis":"down"}` HTTP 503; API running | pass |
| AC7 | `docker compose stop mongo`, then `curl /health` | `{"status":"degraded","mongo":"down","redis":"up"}` HTTP 503; API running | pass |
| AC8 | Stopped both, then `curl -i /health` and searched headers and body for connection details | `{"status":"degraded","mongo":"down","redis":"down"}` HTTP 503; 0 matches. The unit test also passes with a credential in the thrown error | pass |
| AC9 | Started each stopped service, polled `/health`, compared API start time and restart count | HTTP 200 within about 1 second each time; start time unchanged, `restarts=0` | pass |
| AC10 | `npm test -w shared` | Committed JSON schema matches generated output | pass |
| AC11 | `npm test -w shared` | Missing, `0`, `2` and `'1'` rejected | pass |
| AC12 | `npm test -w shared` | Malformed, empty-host, `http:`, `javascript:`, `file:`, `ftp:` and missing URLs rejected | pass |
| AC13 | `npm test -w shared` | One segment, digit-first, underscore-first, reserved word, hyphen and misplaced dots rejected | pass |
| AC14 | `npm test -w shared` | Valid samples accepted | pass |

Automated totals: `shared` 22 of 22 passed, `server` 5 of 5 passed, typecheck 0 errors.

## Known limits
- The generated JSON schema can't express the Java reserved-word check or the full URL parse. Only the zod schema enforces those, so anything that validates `app_config` with the JSON schema alone is less strict.
- After sign-off, AC3 was repeated from a real `git clone` of the first commit with a no-cache API build: all three services healthy, `/health` HTTP 200.
- MongoDB and Redis have no local auth. They are reachable only on the internal Compose network. Production connection details are out of scope for F01.

Sign-off: owner, 2026-11-01
