# F18 Verification

| Criterion | Command or action | Real output or screenshot | Result |
|---|---|---|---|
| AC1 | `shared/test/mail.test.ts` "AC1" | Subjects and bodies of verify, reset, already registered, ready, failed and the receipt equal the earlier text | pass |
| AC2 | `shared/test/mail.test.ts` "AC2" (12 templates) | Text and HTML present, no images or scripts, at most one button, its link also in the text | pass |
| AC3 | `server/test/auth.test.ts` "AC3" | One "Your password was changed" email after a reset | pass |
| AC4 | `server/test/admin.test.ts` "AC4" | Two simultaneous refund clicks send one refund email | pass |
| AC5 | `worker/test/key-upkeep.test.ts` (F13, unchanged) | Reminders still sent once, now from the templates | pass |
| AC6 | `worker/test/build-expiry.test.ts` | Once for a build expiring within a day, run twice; none if downloaded, newer build exists, Premium or unverified | pass |
| AC7 | `server/test/admin.test.ts` "AC7" | One "Your account was disabled" email with HTML | pass |
| AC8 | `server/test/admin.test.ts` "AC8" | Refund and disable succeed with the mail provider down; log has no address | pass |
| AC9 | `shared/test/mail.test.ts` "AC9" | `<script>` is escaped in HTML, as typed in text | pass |
| AC10 | DNS: DKIM `resend._domainkey`, SPF on `send.`, DMARC `p=quarantine` exist; real mail to the owner's inbox | Owner opened the real reset email in Gmail and it displayed correctly | pass |
| Q4 | `dig` for the sending domain | DKIM, SPF and DMARC records found | pass |

Suites: shared 101, server 421, worker 132 pass.

Sign-off: owner, 2026-11-13
