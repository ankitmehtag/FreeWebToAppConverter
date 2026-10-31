# F01 Foundation

Status: approved

## Goal
Give every later feature a working base: one repo, a local stack that starts with one command, a health endpoint that reports real dependency status, and one versioned `app_config` schema shared by the server, worker and Android template.

## Out of scope
- Any Android code (F02).
- Rendering files from `app_config` (F03).
- Queue jobs, the worker's build logic and the builder image (F04). The worker only needs to exist as a folder here.
- Accounts, app records and API routes other than health (F06, F08).
- The React UI (F08, F09, F11). The client only needs to exist as a folder here.
- Production deployment and MongoDB Atlas setup.

## Requirements
- R1: The repo must have the folders `client`, `server`, `worker`, `android-template` and `shared`.
- R2: Secrets must stay out of git. `.env` is ignored, and `.env.example` lists every variable with no real values.
- R3: `docker compose up` on a fresh clone must start the API, MongoDB and Redis with no manual steps beyond copying `.env.example` to `.env`.
- R4: MongoDB and Redis data must survive `docker compose down` and `up`.
- R5: `GET /health` must report the status of MongoDB and Redis separately, based on a live check of each.
- R6: `GET /health` must return 200 when both dependencies are up and 503 when either is down, and it must not crash the API or expose connection strings.
- R7: `shared/` must define the `app_config` schema as the single source of truth, in zod, and generate the JSON schema from it.
- R8: The schema must require `schemaVersion`, and only accept the supported version (`1`).
- R9: The schema must require a valid HTTPS start URL. HTTP is rejected in this version.
- R10: The schema must require a package name that follows Android rules: at least two segments, each starting with a letter, with no Java reserved words.

## Acceptance criteria
- AC1 (R1): Given a fresh clone, when the repo is listed, then all five folders exist.
- AC2 (R2): Given a `.env` file containing a test value, when `git status` and `git check-ignore .env` run, then `.env` is ignored, and `.env.example` contains no real secret.
- AC3 (R3): Given a clean clone with no existing containers, volumes or images for this project, when `.env.example` is copied to `.env` and `docker compose up` runs, then all three services become healthy.
- AC4 (R4): Given a test record in MongoDB and a test key in Redis, when the stack is taken down and started again, then both still exist.
- AC5 (R5, R6): Given all services are up, when `GET /health` is called, then it returns 200 and reports MongoDB and Redis as up.
- AC6 (R5, R6): Given Redis is stopped, when `GET /health` is called, then it returns 503, reports Redis as down and MongoDB as up, and the API keeps running.
- AC7 (R5, R6): Given MongoDB is stopped, when `GET /health` is called, then it returns 503, reports MongoDB as down and Redis as up, and the API keeps running.
- AC8 (R6): Given a dependency is down, when the `GET /health` response is inspected, then it contains no connection string or credential.
- AC9 (R5, R6): Given a dependency that was stopped is started again, when `GET /health` is called, then it returns 200 without restarting the API.
- AC10 (R7): Given the zod schema, when the JSON schema is generated, then a test confirms the committed JSON schema matches the generated output.
- AC11 (R8): Given a config with a missing, older or newer `schemaVersion`, when it is validated, then it is rejected.
- AC12 (R9): Given a config with a malformed URL, an HTTP URL or a non-web scheme such as `javascript:` or `file:`, when it is validated, then it is rejected.
- AC13 (R10): Given a config with a bad package name (one segment, a digit-first segment, a reserved word such as `class`, or a hyphen), when it is validated, then it is rejected.
- AC14 (R7–R10): Given a valid sample config, when it is validated, then it is accepted.

## Open questions
- Q1: Does the brand and `com.sitetoapk.*` prefix change now that the planned domain is `freewebsitetoappconverter.com`? F01 issues no package names, so this doesn't block F01, but it must be settled before F03.
- Q2: Which package layout should the repo use? Proposal: npm workspaces on Node 22 LTS, with TypeScript in `server`, `worker` and `shared`.
- Q3: Should HTTP start URLs ever be allowed? Proposal: HTTPS only in schema version 1, with any change handled by a later schema version.
- Q4: Which other `app_config` fields belong in version 1? Proposal: F01 defines only `schemaVersion`, start URL, package name and app name, and F02 adds its behaviour toggles through a spec update.
