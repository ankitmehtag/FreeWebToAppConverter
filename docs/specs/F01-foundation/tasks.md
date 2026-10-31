# F01 Tasks

## Design
- npm workspaces on Node 22 LTS, with `shared` and `server` as packages. `client`, `worker` and `android-template` hold only a README until their features start, so that git keeps the folders.
- `shared/src/app-config.ts` is the zod source of truth. `npm run generate -w shared` writes `shared/app-config.schema.json`, which is committed.
- `GET /health` returns `{ status, mongo, redis }`: `status` is `ok` or `degraded`, and the other two are `up` or `down`. Each check has a 2 second timeout.
- The app takes its checks as arguments, so tests can fail them without real services. The AC6–AC9 outage behaviour is then proven against the real stack.
- Only the API port is published, on `127.0.0.1`. MongoDB and Redis stay on the internal Compose network with no published ports and no local auth. Production uses Atlas (out of scope here).

## Slices
- [x] T1: Repo scaffold, ignore rules and `.env.example` (R1, R2)
  - Proof: AC1, AC2
- [x] T2: `app_config` schema and generated JSON schema (R7, R8, R9, R10)
  - Tests first: AC10, AC11, AC12, AC13, AC14
- [x] T3: Health endpoint (R5, R6)
  - Tests first: AC5, AC6, AC7, AC8
- [x] T4: Docker Compose stack (R3, R4)
  - Proof: AC3, AC4
- [x] T5: Outage checks against the real stack (R5, R6)
  - Proof: AC5, AC6, AC7, AC8, AC9
