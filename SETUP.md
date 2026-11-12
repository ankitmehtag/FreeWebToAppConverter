# Setting up on another computer

This gets the code running on a new machine. It holds no secrets: those you carry over yourself (see the last section).

## 1. Install
- Git
- Node.js 22 (`.nvmrc` says 22; `nvm use` picks it)
- Docker Desktop (or Docker Engine with the Compose plugin)

## 2. Get the code
```sh
git clone https://github.com/ankitmehtag/FreeWebToAppConverter.git
cd FreeWebToAppConverter
npm ci
```
The repository is private, so Git asks you to sign in to GitHub the first time.

## 3. Settings
```sh
cp .env.example .env
```
Then fill `.env`. The file is never committed.

- **Enough to start:** the defaults already in `.env.example` (`PORT`, `MONGO_URL`, `REDIS_URL`, `APP_URL`, `API_URL`, `SMTP_URL`, `BUILDER_IMAGE`), plus a `JWT_SECRET` of your own (`openssl rand -hex 32`) and a `MAIL_FROM`.
- **Email locally:** leave `RESEND_API_KEY` empty. `SMTP_URL` already points at Mailpit, which Compose runs. Open its inbox at http://localhost:8025 to read verify and reset emails.
- **Left empty, a feature is simply off:** payments (`RAZORPAY_*`), Google sign-in (`GOOGLE_*`), the admin panel (`ADMIN_EMAILS`), Premium keys (`KEYSTORE_MASTER_KEY`), push, and the safety lookup (`WEB_RISK_API_KEY`).
- Outside local use, create new keys. Do not reuse production ones on a laptop.

## 4. Run it
```sh
docker compose up -d        # Mongo, Redis, local S3, Mailpit, the API
npm run dev -w client       # the website, at http://localhost:5173
```
The API listens on `127.0.0.1:3000` and the client proxies to it.

## 5. Build APKs (optional)
The worker runs on the host because it starts a Docker container per build. First make the builder image, from `android-template/`:
```sh
docker build --platform linux/amd64 --build-arg VERSION_SHA=$(shasum -a 256 version.json | cut -d' ' -f1) -t sitetoapk-builder:dev .
```
Then set the worker values in `.env` (`KEYSTORE_PATH`, `KEYSTORE_PASSWORD`, `KEY_PASSWORD`, `KEY_ALIAS`, `SIGNER_SHA256`, all for a throwaway test key) and start it:
```sh
npm start -w worker
```
On an Apple Silicon Mac the image runs under emulation, so a build takes several minutes. Production timings are faster.

## 6. Check everything works
```sh
npm run typecheck
npm test
```
Tests need the Compose services from step 4 (Mongo, Redis, S3). The worker tests that run a container need the builder image.

## What is not in GitHub, and you must carry over
Move these through a password manager or an encrypted file. Never by chat or email.

| Item | Where it is now | Why you need it |
|---|---|---|
| Real `.env` values (Razorpay, Resend, Google, Firebase, `JWT_SECRET`) | Server `/opt/sitetoapk/.env.production`, and your local `.env` | Only to run those features. Local development works without them |
| Deploy key `~/.ssh/sitetoapk_deploy` | This Mac | Without it, the new computer cannot reach the server. Copy the file, keep `chmod 600` |
| Backup folder `~/Documents/sitetoapk-backup/` | This Mac | Holds the Premium keystore master key. Losing it loses every Premium signing key. Keep two copies in two places |
| Admin sign-in code | The authenticator app on your phone | `/admin` needs it. The new computer needs nothing; a new phone needs the setup repeated with `npm run admin-2fa -w server -- <email>` on the server |

## Deploying from the new computer
Needs the deploy key above. The steps and the server's settings are in `deploy/README.md`. The short version, on the server:

```sh
cd /opt/sitetoapk && git pull && npm ci
cd deploy && SITE_ADDRESS=freewebsitetoappconverter.com docker compose -f compose.prod.yml up -d --build --wait
systemctl restart sitetoapk-worker
```
`git pull` on the server sometimes fails with "Could not resolve host". Run it again.
