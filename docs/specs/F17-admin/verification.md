# F17 Verification

| Criterion | Command or action | Real output or screenshot | Result |
|---|---|---|---|
| AC1 | `curl https://freewebsitetoappconverter.com/admin/api/{overview,2fa,users}` without a session; test `AC1` | `{"error":"Not found"}` 404 each; 4 tests pass | pass |
| AC2 | `test/admin.test.ts` "AC2: the second step" | Routes return 401 `two_factor` until a correct code; a used code and 5 wrong codes are refused | pass |
| AC3, AC4 | `test/admin.test.ts` "AC3-AC4, AC8" | Overview counts match the database; user search lists apps | pass |
| AC5 | `test/admin.test.ts` "AC5: plan change" | Plan changes, one audit entry | pass |
| AC6 | `test/admin.test.ts` "AC6: refund" | Two simultaneous clicks give 200 and 409; one provider refund | pass |
| AC7 | `test/admin.test.ts` "AC7: the audit log" | PUT, DELETE and PATCH on an entry return 404; entry stays | pass |
| AC8 | `test/admin.test.ts` "never returns a secret" | No secret field in any response | pass |
| Deploy | commit dd3e83d on production; `/health` 200; `X-Robots-Tag: noindex, nofollow` on `/admin` | as shown | pass |
| Live sign-in | Owner signs in at `/admin` with both emails and a code | Owner signed in and saw the panel | pass |

Full server suite 417 pass, client 76 pass.

Sign-off: owner, 2026-11-12
