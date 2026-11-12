# F18 Email

Status: done

## Goal
Every email the product sends comes from one place, looks like it belongs to the product (a plain, branded HTML version plus a text version), and the few useful messages that are still missing get sent. All are transactional: no marketing, so no unsubscribe list is needed.

## Today
Seven emails exist, all plain text, each built where it is sent: verify email, reset password, already registered, receipt, build ready, build failed (worker), and the abuse report (to the owner). The worker also already sends the signing-key backup reminders (day 1 and day 7) and the erase notice (F13), through an hourly job.

## Out of scope
- Marketing or newsletter email, and an unsubscribe system.
- Premium expiry and renewal notices: Premium is a one-time purchase per app, so nothing expires (revisit with F20 Reseller).
- Email in languages other than English.
- A paid email plan: Resend's free tier (100 a day, 3,000 a month) is assumed.

## Requirements
- R1: All email text lives in one module (`shared/src/mail.ts`), one function per email returning `{ subject, text, html }`. The worker and the server use the same module, so there is one copy of every email.
- R2: Every email has a text part and an HTML part, except the abuse report, which stays text only so nothing a reporter writes can change how the owner reads it. The HTML is one table-free, inline-styled layout (name, a heading, short body, one button, a footer with the site address and why the email was sent) that works without images and in dark mode.
- R3: The existing seven emails move to the templates with their wording kept, and every link still works.
- R4: New email, password changed: sent to the account when the password is reset or changed, saying when it happened and what to do if it was not them.
- R5: New email, refund confirmation: sent to the buyer when an order is refunded, with the receipt number and amount.
- R6: (Changed during build.) The key backup reminders and the erase notice already exist from F13 (day 1 and day 7, hourly job). They move into the templates; no new key email is added.
- R7: New email, Free build expiring: sent once, 1 day before a Free build's files are deleted, if the user has not downloaded it (one per build, and only for the app's latest build).
- R8: New email, account disabled: sent to the user when the admin disables the account, with the contact address.
- R9: A failed send never breaks the action that caused it, and is logged without the recipient's address or the link. Verify and reset emails may be re-requested.
- R10: A template never puts user text into HTML unescaped, and never puts a secret (key password, token other than the one-time link the email is for) into any email.
- R11: Each reminder (R6, R7) is sent at most once, even if the worker restarts or two workers run.

## Acceptance criteria
- AC1 (R1, R3): Given each of the seven existing emails, when it is triggered, then its subject and links match what is sent today and it comes from the template module.
- AC2 (R2): Given any template, when it is rendered, then it has a non-empty text and HTML part, the HTML has one button whose link is also in the text, and it has no external images or scripts.
- AC3 (R4): Given a password reset, when it completes, then one "password changed" email goes to the account.
- AC4 (R5): Given a paid order, when it is refunded (by the admin or a provider event), then one refund email goes to the buyer, once.
- AC5 (R6, R11): Given a Premium key not downloaded after a day, when the job runs twice, then exactly one email is sent (existing F13 tests, unchanged); if downloaded, none.
- AC6 (R7, R11): Given a Free build that expires within a day and was not downloaded, when the job runs twice, then exactly one email is sent; for an older build of the same app, none.
- AC7 (R8): Given the admin disables a user, then one "account disabled" email goes to that user.
- AC8 (R9): Given the mail provider is down, when any action sends an email, then the action still succeeds and the log has no address.
- AC9 (R10): Given an app name such as `<script>x</script>`, when it appears in an email, then the HTML shows it escaped and the text shows it as typed.
- AC10 (R2): Given a real send to the owner's inbox through Resend, then it shows correctly in Gmail (light and dark) and is not in spam.

## Open questions
- Q1: Should the HTML be a simple single-column layout with the product name as text, no logo image? Proposed: yes, no images, so nothing to host and nothing blocked.
- Q2: Option A chosen by the owner: R7 runs in the worker's existing hourly job, with each build claimed in the database so it is sent once.
- Q3: Is a "welcome" email after verification wanted? Proposed: no, it adds nothing the verify step doesn't.
- Q4: Is SPF/DKIM already set for the sending domain in Resend? Proposed: I check the DNS and tell you, since AC10 depends on it.
