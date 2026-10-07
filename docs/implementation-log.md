# Implementation log

## Foundation

Implemented Next.js application shell, responsive sidebar, dashboard, Better Auth login, server role enforcement, team administration, and general settings. PostgreSQL schema and initial migration cover the CRM modules and authentication tables. Development seed is repeatable, preserves existing record fields/passwords, and restores missing fixtures and original fixture tag links.

Verified migration apply/reapply, schema validation, repeatable seed, real browser login, anonymous rejection, cross-origin mutation rejection, and a successful production build of the foundation/customer routes.

## Customers, imports, segments, follow-ups

Implemented customer CRUD/archive, normalized-phone uniqueness, classification administration, combined URL filters, sorting, column visibility, bulk actions, CSV/XLSX import/export, dynamic segments, private saved views, notes, follow-ups, and a paginated merged timeline.

Browser validation created a customer, persisted a note, scheduled/completed a follow-up, and reloaded the note. Database tests cover a 1,000-row XLSX import, duplicate choices, stale reviews, repeat/concurrent commits, formula-safe exports, assignment restrictions, follow-up state transitions, and notes. A JSONB key-order comparison issue found during testing was corrected with structural comparison.

## WhatsApp and campaigns

Implemented the provider abstraction, visible mock mode, durable simulated send/delivery/read/failure/reply events, Meta connection settings, template sync, paginated inbox, server-enforced replies, conversation assignment, and unmatched-contact review. Signed inbound events update conversations, customer activity, opt-out evidence, and campaign reply attribution. Delivery receipts update message state and campaign aggregates atomically, deduplicate retries, and replay when they arrive before outbound persistence.

Implemented campaign creation with dynamic audience filters or segments, exclusion previews, rendered variables, test send, explicit recipient-count confirmation, scheduling, transactional recipient snapshots, and pause/resume/cancel controls. The separate PostgreSQL worker uses bounded batches, `SKIP LOCKED` claims, a shared send-rate clock, and eligibility checks immediately before provider calls. It records attempted sends before crossing the provider boundary; ambiguous results and interrupted attempted sends require manual review. Campaign reports include delivery/reply totals, response classification, lightweight conversion details, and recipient export.

Changed modules: `src/modules/whatsapp`, `templates`, `conversations`, and `campaigns`; their pages/API handlers; `src/worker.ts`; and domain, PostgreSQL integration, and browser tests. The initial migration already includes the queue, webhook, messaging, mock-event, and campaign tables, so these features required no additional migration.

Regression coverage includes signed webhook account scoping, duplicate/out-of-order receipts, orphan-event replay, mock delivery failure, STOP handling, exact service-window expiry, unmatched-contact linking, and customer authorization. Campaign tests cover a 1,000-recipient snapshot, duplicate launch, non-overlapping claims, scheduled execution, pause/cancel, consent changes before send, template/provider changes, bounded retry, and crash recovery. The browser campaign workflow exercises preview, test, confirmation, worker delivery, and an incoming reply.

## Security and integrity review

Live free-form windows now require signed inbound provenance from the currently configured business account and phone-number ID, matching the customer's current primary phone. Mock and seed messages cannot authorize live replies. Unmatched-contact resolution replays the original verified event rather than manufacturing a new inbound event.

Live templates require a numeric Meta ID and a recent approval sync. Unsupported template parameters are rejected. Campaign fingerprints bind the reviewed template content, variable mapping, and provider mode, so later changes invalidate preview/test approval and block queued sends. Standard opt-out commands remain active when additional languages or words are configured.

Customer and import consent changes preserve explicit opt-out evidence unless a new opt-in is deliberately recorded. Import review detects intervening record changes, files have size/expansion limits, and exports neutralize formula prefixes. Server role checks protect customer scope, mutations, imports, campaign controls, and settings.

Updated vulnerable transitive dependencies through narrow, pinned overrides and the patched CSV parser major; generation, migrations, spreadsheet workflows, and final checks must continue to be run together when these versions change. Local startup preserves existing environment values, restricts database restoration to an empty matching local mock database, and stores development snapshots in an ignored file with restrictive permissions.

## External configuration

Mock development requires no Meta credentials. Live connection, current Meta policy/version confirmation, public HTTPS webhook registration, and real delivery/read testing require the business's Meta environment. Advanced inbound media download/storage and media/dynamic-button template parameters remain outside the implemented text-template sending path.

## Final combined verification — 7 October 2026

- Clean locked installation with `npm ci`; local environment initialization, PostgreSQL startup, Prisma generation, migration reapply, and repeat seed all succeeded.
- TypeScript and ESLint passed. All 86 unit tests across 11 files and 52 PostgreSQL integration tests across 6 files passed.
- All 7 Playwright workflows passed together: campaign scheduling/controls and actual mock worker delivery/reply/classification; customer creation, notes and follow-up completion; salesperson restrictions and private views; anonymous access; team creation/deactivation; mobile navigation; and 1,000-row XLSX import/export.
- Optimized production build passed. A production-server browser smoke verified login, secure HttpOnly SameSite session cookies, anonymous API rejection, authenticated customers, dashboard, inbox, reports, templates, and settings with no browser runtime errors. Desktop screenshots were visually inspected.
- Production dependency audit reported zero known vulnerabilities. Dependencies include upstream deprecation notices; audit results are a point-in-time check, not a guarantee against undiscovered issues.
- The ignored development database backup restored successfully into an isolated temporary database, which was then removed. The final snapshot was refreshed after browser fixture cleanup. Fresh cloud-task restoration remains unverified.
- Tested setup and startup instructions were saved to the cloud environment draft, with Meta API/documentation domains added alongside the existing Prisma domain. Publishing still requires review/save and publish through environment settings.

The application and worker are ready for local mock development. No real WhatsApp messages were sent. Live Meta validation and the documented media extensions remain outstanding.
