# F07 Tasks

## Design
- `server/src/url/` holds the feature. `createApp` mounts it under `/url` only when a fetcher and auth are passed, so `/health` keeps its own tests.
- `isPublicAddress` is the single address rule. IPv4 and IPv6 must be global unicast. An IPv4-mapped or NAT64 address is judged by the IPv4 address inside it, because DNS64 networks answer NAT64 for ordinary sites. 6to4 and Teredo are refused outright.
- `createFetcher` returns the fetch function. Its resolver, address rule, ports and limits can be injected, so tests can run against local servers while the real rule still judges everything else.
- A hop resolves once, checks every address, and pins the first through the request's `lookup`. The URL keeps its hostname, so TLS checks the certificate against it.
- One deadline covers every hop of a fetch, including DNS.
- The route reuses `allowOrigin`, `limitRoute` and the shared error handler from auth.

## Slices
- [x] T1: Address rule and URL parsing (R1, R2, R3)
  - Tests first: AC1, AC2, AC3, AC4
- [x] T2: Pinned fetch, redirects and limits (R4, R5, R6, R7)
  - Tests first: AC5, AC7, AC8, AC9
- [x] T3: URL checker route (R8, R9, R10)
  - Tests first: AC10, AC11, AC12
- [x] T4: Real site proof (R4)
  - Proof: AC6
