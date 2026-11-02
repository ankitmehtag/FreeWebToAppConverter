# F07 Verification

Run on 2026-11-03. Automated tests used an injected resolver, a local server, and Redis and Mongo in Compose. The rows marked Compose ran against the real API, with real DNS, on Node 22 in its container.

Status: all criteria pass, signed off by the owner on 2026-11-03.

| Criterion | Command or action | Real output | Result |
|---|---|---|---|
| AC1 | `npm test -w server` | `ftp:`, `file:`, `gopher:`, `data:`, ports 8443 and 22, and URLs with credentials refused with 0 lookups; text that is no URL answers `invalid_url` | pass |
| AC2 | `npm test -w server`; Compose: `http://2130706433/`, `http://[::1]/` | All 8 spellings refused with no connection; both `blocked` in Compose | pass |
| AC3 | `npm test -w server` | 38 values refused and 12 allowed, including `172.32.0.1`; a host resolving to a blocked address gets no connection | pass |
| AC3 (Compose) | `http://169.254.169.254/`, `http://[64:ff9b::a9fe:a9fe]/`, `http://[::ffff:a9fe:a9fe]/`, `http://mongo/`, `http://api:3000/health` | All `blocked` | pass |
| AC4 | `npm test -w server` | One public and one private address refused, with no connection | pass |
| AC5 | `npm test -w server` | 1 lookup; connected to the checked address, though the resolver would have answered `10.0.0.1` next | pass |
| AC6 | Compose: `https://example.com/`, `https://badssl.com/` | Both reachable, HTTPS true | pass |
| AC6 (wrong certificate) | Compose: `https://wrong.host.badssl.com/`, `https://self-signed.badssl.com/`, `https://expired.badssl.com/` | All `unreachable`. A direct request confirmed `ERR_TLS_CERT_ALTNAME_INVALID`, `DEPTH_ZERO_SELF_SIGNED_CERT` and `CERT_HAS_EXPIRED` | pass |
| AC7 | `npm test -w server` | Metadata, private host and `file:` redirects refused at that hop; 5 redirects followed, the 6th refused | pass |
| AC8 | `npm test -w server` | Stalled and trickling servers and a hung lookup stop at the deadline; size limit stops the read; the socket closes in both server cases; gzip stays unexpanded | pass |
| AC9 | `npm test -w server` | With `HTTP_PROXY` set the proxy got 0 requests; the server saw only `accept`, `accept-encoding`, `connection`, `host` and `user-agent` | pass |
| AC10 | `npm test -w server`; Compose: `http://example.com/` | Viewport, HTTPS, `X-Frame-Options` and `frame-ancestors` answers correct; `unknown` for a compressed page; a hostile 1.6 MB page reads in under a second; Compose answers `https: false` | pass |
| AC11 | `npm test -w server` | Each failure answers only its code; no IP, body or raw error | pass |
| AC12 | `npm test -w server` | 10 checks answer 200, the 11th 429; extra fields, non-strings and a 2049 character URL answer 400 | pass |

Automated totals: `shared` 42 of 42, `server` 157 of 157, `worker` 90 of 90, typecheck 0 errors.

## Found while verifying
- The first version refused every NAT64 address, which R3 doesn't ask for. On this network DNS answers `64:ff9b::689a:5969` for `badssl.com`, which is its public IPv4 address, so real sites came back `blocked`. Mapped and NAT64 addresses are now judged by the IPv4 address inside them.

## Known limits
- The tests run on Node 25 locally and the API runs on Node 22. The Compose rows cover pinning, TLS and refusal on Node 22; the proxy and limit tests ran only on Node 25.

Sign-off: owner, 2026-11-03
