# F07 URL safety

Status: approved

## Goal
Let the server fetch a URL that a stranger typed, without that URL ever reaching our own network, cloud metadata or anything else that isn't the public internet. On top of that fetcher, give a URL checker that says whether a site is reachable, uses HTTPS, looks mobile ready and can be embedded. The wizard (F08) and the public website (F11) both depend on this, so it is proven before either exists.

## Out of scope
- All screens. The wizard uses the checker in F08, and the landing page uses it in F11.
- Prefilling name, colours and icon, and the phone preview, which are F08. F07 gives them the fetcher.
- The screenshot fallback for sites that block embedding. It needs headless Chromium, so it is decided in F08.
- Safe Browsing and the brand denylist, which are F10.
- Network rules outside the app, such as a production egress firewall.

## Requirements

### Safe fetching
- R1: The fetcher must accept only `http` and `https` URLs on ports 80 and 443, and must refuse URLs carrying a username or password.
- R2: Hosts must be read in their normalised form, so that decimal, octal, hex and short IP spellings are judged as the IP they really are.
- R3: The fetcher must resolve DNS itself, and must refuse a host if any resolved address is not a public unicast address. This covers private, loopback, link-local, metadata, carrier-grade NAT, multicast and reserved ranges, in IPv4 and IPv6, including IPv4-mapped, NAT64 and 6to4 forms of a blocked IPv4 address.
- R4: The connection must go to the exact address that was checked, with no second DNS lookup, while TLS still verifies the certificate against the hostname.
- R5: Redirects must be followed by hand, at most 5, and every hop must pass R1 to R4 again.
- R6: A fetch must stop at 10 seconds in total and at 2 MiB of response, counted as bytes received. It must ask for uncompressed content and must not decompress a response.
- R7: The fetcher must ignore proxy settings from the environment, and must send no cookies, credentials or internal headers.

### URL checker
- R8: `POST /url/check` must take a URL, and answer whether it is reachable, whether its final URL is HTTPS, whether its HTML has a mobile viewport tag, and whether its headers allow embedding.
- R9: The answer must never contain the response body, the resolved IP or a raw error. A failure must be one of `invalid_url`, `blocked`, `unreachable`, `timeout` or `too_large`.
- R10: The route must work without an account, use zod validation, and be limited to 10 checks per 15 minutes per IP, using Redis.

## Acceptance criteria
- AC1 (R1): Given `ftp:`, `file:`, `gopher:`, a port other than 80 or 443, or `https://user:pass@example.com`, when fetched, then it is refused before any DNS lookup.
- AC2 (R2): Given `2130706433`, `0177.0.0.1`, `0x7f.1`, `127.1` and `[::ffff:127.0.0.1]` as hosts, when fetched, then each is refused as loopback.
- AC3 (R3): Given each blocked range, including `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`, `169.254.169.254`, `100.64.0.0/10`, `0.0.0.0/8`, `::1`, `fc00::/7`, `fe80::/10`, `::ffff:169.254.169.254` and `64:ff9b::a9fe:a9fe`, when a host resolves to it, then it is refused with no connection made. An address just outside a range, such as `172.32.0.1`, is allowed.
- AC4 (R3): Given a host with one public and one private address, when fetched, then it is refused.
- AC5 (R4): Given a resolver that answers a public address first and a private one after, when fetched, then only one lookup happens, and the connection goes to the first address.
- AC6 (R4): Given a real HTTPS site, when fetched, then the certificate is checked against its hostname, and a wrong certificate is refused.
- AC7 (R5): Given a redirect to a metadata address, a private host or a blocked scheme, when followed, then it is refused at that hop. Given 6 redirects, then it is refused, and 5 succeed.
- AC8 (R6): Given a server that stalls, or sends more than 2 MiB, when fetched, then it stops at the limit and the connection is closed. A compressed response is not expanded.
- AC9 (R7): Given `HTTP_PROXY` set in the environment, when fetched, then the proxy gets no traffic. A test server sees no cookie or internal header.
- AC10 (R8): Given sites with and without HTTPS, a viewport tag, `X-Frame-Options` and CSP `frame-ancestors`, when checked, then each answer is correct.
- AC11 (R9): Given each failure, when checked, then the answer holds only its failure code, and no body, IP or raw error.
- AC12 (R10): Given 11 rapid checks from one IP, then the last answers 429. Extra fields and non-string URLs are refused.

## Decisions
- The address rule is an allowlist: only public unicast passes, so a range nobody listed is refused.
- `http` is allowed so that the checker can tell a user their site has no HTTPS. The app itself still needs HTTPS, as `app_config` requires.
- A host with any blocked address is refused outright, rather than connecting to a public one that happens to be listed.
- Bytes are capped as received, with no decompression, so a compressed bomb costs nothing. If a server compresses anyway, the viewport answer is `unknown`.
- `/url/check` stays open without an account, because the landing page needs it (F11), and the limit in R10 protects it.
- The limit is 10 checks per 15 minutes per IP, and can be raised if the wizard feels it.
- Automated tests use an injected resolver and local servers. AC6 is proven once against a real site.

## Open questions
None.
