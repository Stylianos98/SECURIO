# Implementation and release tracking

Audited demo at `f2ef7a9c8f2c7a56bad534223e2aa7ef1c3da35e`. The tree contained README.md, index.html, app.js and styles.css with no automated test suite. Its four views use in-browser role switching and localStorage. Attachments, geolocation verification, reports, schedule import and calls are placeholders. The new app retains the demo palette, typography and role workflows on a separate branch.

| Requirement | Current implementation | Remaining release work |
| --- | --- | --- |
| GUARD authentication and duty | Email/password, cookie session, active-duty jobs tied to tenant and guard, Start/Done/Blocked, server timestamps | Separate job-free duties, upcoming duty display, supported roster fixture |
| GUARD point-in-time location | — | Site/job configuration, opt-in point capture and server-side verification |
| GUARD PWA and languages | Install manifest, public shell cache, in-session job retry queue, English/Greek guard labels | Cold-restart offline duty, structured outbox and conflict recovery, offline drafts and attachments, language QA |
| Incidents | Guard submission, lifecycle advances, separate approved client summary, revocation, admin soft deletion with reason | Private photo/document upload, malware scanning, severity, internal notes and full history |
| SOS | Confirmed POST, explicit unconfirmed delivery, dashboard polling, acknowledge and resolve | External alert delivery, accessibility and mobile drills, reliable retry recovery across reloads |
| COMMAND | Site-scoped jobs, bounded search, overdue calculation, incident triage, active SOS, messages, audit, scoped job CSV | Durable overdue attention items, site/job threshold overrides, notifications, richer site views, server search/paging, PDF and scheduled reports |
| CLIENT | Authorized property coverage, stale state, approved summaries, configured phone and separate per-client message thread | Sanitized activity/reporting, per-site freshness, real-time transport and read receipts |
| ADMIN | Company name, overdue threshold, site upsert, access grants, account enable/disable, CSV import, audit | Account creation and role changes, MFA enrollment/recovery, notification and retention settings |
| RosterDroid | Configurable CSV header mapping, atomic upserts, stable job IDs, cancellation, successful sync time | Confirm export format and compatibility, per-site freshness, failed import tracking |
| Application security | Server role and site checks, composite tenant relations at core boundaries, scrypt, encrypted TOTP and replay protection, secure cookies on HTTPS origin, CSRF origin checks, bounded JSON, per-account login limiting, append-only audit trigger | Hardening and independent review, broader throttling and abuse protection, RBAC race review, deployment isolation, file controls, retention and privacy review |
| Runtime and release | PostgreSQL migrations, Compose, Caddy template, GitHub Actions verification | Authorized staging, deployed HTTPS, automated releases and monitoring, backup/restore exercise, 50-guard pilot and 280-guard load verification |

The current browser queue persists job action identifiers only and is isolated by account. Keep the page open when offline. Failed queued writes stop subsequent attempts and require reconciliation. The server uses its own clock and refuses job progress after duty ends. CLIENT and COMMAND use five-second polling. Client reports and exports are unavailable. Coverage derives from current imported jobs and can be inaccurate after an incomplete export.

Delivery order from this baseline:

1. Verify the working vertical slice on a synthetic, access-controlled staging environment.
2. Complete roster validation, incident attachments, guard offline durability, location and operational alert delivery.
3. Complete client and administration functionality, retention and export/reporting.
4. Verify recovery, conduct security review and run the user acceptance and capacity pilots.
