# Deploying Free Website to App Converter

One server runs everything, to keep the bill to that one machine. R2 and Resend stay on their free allowances.

| Part | Where it runs |
|---|---|
| Caddy: the site, TLS and the route to the API | `compose.prod.yml` |
| API, Mongo, Redis | `compose.prod.yml` (Mongo and Redis listen on the host's loopback only) |
| Worker | On the host, as a service, because it starts a Docker container per build |
| APKs and icons | Cloudflare R2 |
| Email | Resend |

## The server
- An x86-64 Linux machine with at least 4 CPUs, 8 GB of memory and 40 GB of disk. Each build takes 2 CPUs and up to 4 GB, so 4 CPUs allow 1 to 2 builds at once (`BUILD_CONCURRENCY`).
- Docker Engine with the Compose plugin, Node.js 22, `git`.
- Ports 80 and 443 open. Nothing else.
- The domain's A record (and AAAA, if the server has IPv6) pointing at the server, before Caddy starts, so it can get its certificate.

## Settings
Copy `.env.example` to `.env.production` in the repository root, set every value below, and keep the file only on the server (`chmod 600`). It is never committed.

| Setting | Secret | Value in production |
|---|---|---|
| `PORT` | no | `3000` |
| `MONGO_URL`, `REDIS_URL` | no | Set by `compose.prod.yml` for the API. For the worker: `mongodb://127.0.0.1:27017/sitetoapk` and `redis://127.0.0.1:6379` |
| `APP_URL`, `API_URL` | no | `https://freewebsitetoappconverter.com` (both, because the API sits behind the same origin) |
| `INSTALL_URL` | no | Empty |
| `TRUST_PROXY` | no | Set by `compose.prod.yml` to Caddy's network |
| `JWT_SECRET` | **yes** | `openssl rand -hex 32` |
| `MAIL_FROM` | no | `Free Website to App Converter <noreply@freewebsitetoappconverter.com>` |
| `RESEND_API_KEY` | **yes** | A Resend key limited to sending |
| `SMTP_URL` | no | Empty in production |
| `REPORTS_EMAIL` | no | `abuse@freewebsitetoappconverter.com`, or the support address |
| `WEB_RISK_API_KEY` | **yes** | Google Web Risk key, limited to that API. Empty leaves the unsafe-site check off |
| `GOOGLE_CLIENT_ID` | no | The Google OAuth client, with `https://freewebsitetoappconverter.com/auth/google/callback` allowed |
| `GOOGLE_CLIENT_SECRET` | **yes** | From the same client |
| `R2_ENDPOINT`, `R2_BUCKET` | no | The R2 account endpoint and bucket |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | **yes** | A token limited to that bucket, Object Read and Write |
| `BUILDER_IMAGE` | no | `sitetoapk-builder:<version>` |
| `WORK_ROOT` | no | `/var/lib/sitetoapk/builds` |
| `KEYSTORE_PATH` | no | `/etc/sitetoapk/shared.jks`, readable by the worker only |
| `KEYSTORE_PASSWORD`, `KEY_PASSWORD` | **yes** | The shared key's passwords |
| `KEY_ALIAS` | no | The shared key's alias |
| `SIGNER_SHA256` | no | The shared key's certificate SHA-256, lower case, no colons |
| `BUILD_CONCURRENCY` | no | `1` on a 4-CPU server, `2` on 8 CPUs |
| `BUILD_TIMEOUT_MS` | no | `900000` |

The shared signing key is created once, at launch, and backed up somewhere other than the server. Losing it means apps can't be updated over their old installs.

```sh
keytool -genkeypair -keystore /etc/sitetoapk/shared.jks -alias shared -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Free Website to App Converter"
```

## First start
```sh
git clone https://github.com/ankitmehtag/FreeWebToAppConverter.git /opt/sitetoapk && cd /opt/sitetoapk
npm ci
npm run build -w client

# The builder image, then its check: it must pass before any build runs.
(cd android-template && docker build --platform linux/amd64 --build-arg VERSION_SHA=$(sha256sum version.json | cut -d' ' -f1) -t sitetoapk-builder:<version> .)
set -a; . ./.env.production; set +a
MONGO_URL=mongodb://127.0.0.1:27017/sitetoapk npm run verify-image -w worker -- sitetoapk-builder:<version>

# The site, the API, Mongo and Redis.
cd deploy && SITE_ADDRESS=freewebsitetoappconverter.com docker compose -f compose.prod.yml up -d --build --wait
```

The R2 lifecycle rule that deletes Free APKs after 7 days needs a token with bucket admin rights, or `wrangler r2 bucket lifecycle add`, as in F05.

## The worker as a service
`/etc/systemd/system/sitetoapk-worker.service`:

```ini
[Unit]
Description=Free Website to App Converter build worker
After=docker.service
Requires=docker.service

[Service]
WorkingDirectory=/opt/sitetoapk
EnvironmentFile=/opt/sitetoapk/.env.production
Environment=MONGO_URL=mongodb://127.0.0.1:27017/sitetoapk
Environment=REDIS_URL=redis://127.0.0.1:6379
ExecStart=/usr/bin/npm start -w worker
Restart=always

[Install]
WantedBy=multi-user.target
```

Then `systemctl enable --now sitetoapk-worker`. Killing it mid-build is safe: on start it removes the containers the old one left, BullMQ hands their jobs back, and the reaper clears the rest. Only one worker runs per server, and `verify-image` runs before it is restarted, never during.

## Updating
1. `git pull`, `npm ci`, `npm run build -w client`.
2. If `android-template/` changed, build the new builder image, run `verify-image` on it, and only then change `BUILDER_IMAGE`.
3. `docker compose -f compose.prod.yml up -d --build --wait`, then `systemctl restart sitetoapk-worker`.

## Backups
- Mongo, nightly: `docker compose -f compose.prod.yml exec -T mongo mongodump --archive --gzip > /var/backups/sitetoapk-$(date +%F).gz`, keeping 14 days, and copying each to R2 under a `backups/` prefix that the 7-day rule doesn't touch. Restore with `mongorestore --archive --gzip`, and test a restore once before launch.
- R2 holds icons and APKs. Free APKs expire after 7 days by design, so only icons need keeping, and R2 keeps them durably.
- The shared signing key and `.env.production`, copied once to a safe place off the server.

## Before launch
- [ ] Every item under "Accounts needed along the way" in `docs/FEATURES.md`: the Google OAuth callback, a Web Risk key, the lawyer's review of the legal pages, and a mailbox for `support@`.
- [ ] The load test on this server: `npm run load-test -w worker` with the worker service stopped (see `docs/specs/F12-mvp-sign-off`).
- [ ] Lighthouse on the live pages, as in F11.
