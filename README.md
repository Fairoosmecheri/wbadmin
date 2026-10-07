# Reach — private WhatsApp-first CRM

Reach keeps customer records, segmentation, sales follow-ups, conversations, and WhatsApp campaigns in one authenticated workspace. It is a modular monolith, with a separate durable campaign worker. It does not include accounting, billing, inventory, or order processing.

The application runs without Meta credentials in **WhatsApp Mock Mode**. All example customers are fictional. Real WhatsApp sending is an explicit environment configuration change.

## Stack and prerequisites

- Node.js 22.12+; development validated on Node 24.
- Next.js 16 App Router, React 19, strict TypeScript, Tailwind CSS 4, Lucide.
- PostgreSQL 17; Docker with Compose is convenient for local development.
- Prisma 7, Better Auth email/password sessions, Zod, libphonenumber-js.
- ExcelJS and node-csv for bounded XLSX/CSV processing.
- Vitest for domain/database tests; Playwright for browser workflows.

## Run locally

From the repository directory:

```sh
npm ci
npm run setup:local
docker compose up -d --wait db
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

In a second terminal:

```sh
npm run worker
```

`setup:local` creates an ignored `.env` with unique database/authentication secrets and mock mode. It preserves an existing `.env`. Review `.env.example` before using an external database. The application uses port 3000 by default. PostgreSQL is bound to loopback only.

Development sign-in:

| Account | Email | Password |
| --- | --- | --- |
| Administrator | `admin@example.com` | `SEED_ADMIN_PASSWORD`, or `ReachDev!2026` |
| Salesperson 1–3 | `sales1@example.com` … `sales3@example.com` | Same development seed password |

The seed is repeatable and preserves existing record fields and passwords. It recreates missing fixture rows and original fixture tag links, so rerunning it can restore a tag that you removed from a demo customer. It refuses production and non-mock environments. It creates 100 fictional customers, three salespeople, classifications, tags, follow-ups, notes, conversations, templates, segments, and a sample campaign. **Never deploy the development database with these passwords.** Use an empty production database and the administrator bootstrap below.

Live processes do not survive environment snapshots. Restart PostgreSQL, the Next.js server, and the worker when resuming a cloud environment. See `docs/cloud-startup.md`.

## Configuration

All credentials are server-side environment variables; no tokens are sent to the browser. `.env` is ignored by Git.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string; use TLS for a remote database |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Local Compose database configuration |
| `AUTH_SECRET` | At least 32 random characters; generate a unique production value |
| `APP_URL` | Exact application origin, including HTTPS in production; used for auth and CSRF |
| `DEFAULT_PHONE_COUNTRY` | Initial phone parsing default, `IN`; configurable in General settings |
| `APP_TIMEZONE` | Initial business timezone, `Asia/Kolkata`; configurable in General settings |
| `WHATSAPP_MODE` | `mock` by default; `cloud` explicitly selects Meta |
| `META_GRAPH_API_VERSION` | Supported version such as `vNN.N`; deliberately no permanent default |
| `WHATSAPP_ACCESS_TOKEN` | Meta system-user access token |
| `WHATSAPP_PHONE_NUMBER_ID` | The connected Meta phone-number ID |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | The connected WABA ID |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | A random webhook verification token you choose |
| `META_APP_SECRET` | Meta app secret used to verify webhook signatures |
| `WHATSAPP_SEND_BATCH_SIZE` | Recipient claim batch, default 25; clamped to 1–100 |
| `WHATSAPP_SEND_RATE_LIMIT` | Shared worker send rate per second, default 5; clamped to 1–80; respect your Meta limits |
| `WHATSAPP_TEST_NUMBERS` | Comma-separated E.164 numbers authorized for live test sends |
| `WHATSAPP_OPT_OUT_KEYWORDS` | Additional comma-separated opt-out commands; standard commands including `STOP`, `UNSUBSCRIBE`, `CANCEL`, `END`, `QUIT`, `OPT OUT`, and `STOP ALL` always remain enabled |
| `WHATSAPP_REPLY_ATTRIBUTION_DAYS` | Fallback reply attribution window, default 7; bounded to 1–30 |
| `WHATSAPP_TEMPLATE_SYNC_MAX_AGE_HOURS` | Maximum age of a live template approval sync, default 24; bounded to 1–168 |
| `SEED_ADMIN_PASSWORD` | Development fixture password override; does not change existing users |

General settings persist business name, timezone, phone country, and date format. Administrators maintain customer types, areas, routes, and tags in Settings → Customer organization. Team accounts are created by administrators; public signup is disabled.

## Customer workflows

- Customer list uses server pagination, sorting, debounced search, URL filters, column visibility, and bulk actions. Salespeople see only assigned customers.
- Primary numbers are validated and normalized to E.164 before the database unique constraint. Customers are archived rather than deleted.
- Customer detail combines notes, assignments, consent, follow-ups, conversations, campaign history, and a chronological activity timeline.
- Follow-ups support call, WhatsApp, visit, and general tasks; due dates use the business timezone. Completion requires an outcome. Closed tasks remain in history.
- Dynamic segments retain filter definitions. A segment limited to selected customer IDs displays that constraint explicitly. Personal saved views are owner-scoped.

### Import and export

Use **Imports → Upload**, choose CSV/XLSX, map columns, validate, review duplicates, and explicitly confirm the import. Download the example Excel template from the import page.

- Limits: 10 MB, 10,000 customer rows, 100 columns per file; first worksheet for XLSX.
- The wizard previews and paginates rows. Validation distinguishes invalid rows, existing normalized-phone duplicates, in-file duplicates, and warnings.
- Existing records are skipped, explicitly updated, or decided individually. A stale review is rejected; it never silently overwrites intervening changes.
- Marketing permission is imported only from explicit affirmative source data. Missing consent does not invent permission or silently erase existing consent.
- Import batches and reports persist. Failed rows can be downloaded.
- Filtered/selected CSV and XLSX exports read the database in chunks and neutralize spreadsheet formulas. Administrator authorization is enforced server-side.

## Mock WhatsApp

With `WHATSAPP_MODE=mock`, the provider never calls Meta. Use **Templates → Sync templates**, open Inbox, and use the mock incoming-message action to exercise customer replies and opt-outs.

Mock outbound messages create durable events for sent, delivered, read, and an incoming reply. The worker processes them. Include `[mock:fail]` in a mock text/message body to simulate failure. Keep the worker running to see status changes. The interface visibly labels mock mode.

Free-form replies require a customer message within the 24-hour service window. Outside that window, select an approved template. The server enforces this rule and customer access. Simulated incoming messages only open a mock service window: switching to cloud mode requires a signed inbound message for the current Meta business account, connected number, and customer's current primary phone.

## Meta Cloud API

1. Provision the official Meta WhatsApp Business Platform and an authorized system-user token. Use the [Meta Cloud API documentation](https://developers.facebook.com/docs/whatsapp/cloud-api/) to confirm the currently supported Graph API version and account requirements.
2. Configure the six Meta/WhatsApp variables above, authorized test numbers, `APP_URL` with your public HTTPS origin, and explicitly set `WHATSAPP_MODE=cloud`.
3. Allow outbound HTTPS to `graph.facebook.com`. Restart both the web process and worker.
4. In Settings → WhatsApp, test the connection. Sync templates from Meta; mock templates are not valid for real sends.
5. Configure the callback endpoint `/api/webhooks/whatsapp` on your public HTTPS application, using your verification token. Subscribe to the required WhatsApp message events.
6. Test a permitted internal number, verify inbound events and delivery/read statuses, then perform a limited trial with documented customer consent.

The GET endpoint verifies Meta's challenge. POST bounds the body to 1 MiB, verifies `X-Hub-Signature-256` over the raw body using the app secret, and checks the configured business-account and phone-number IDs. Events are persisted and deduplicated; statuses never regress from read/delivered due to late events. Events arriving before outbound persistence are replayed by the worker. Unknown phone numbers enter an unmatched-contact review flow; linking requires an exact primary-phone match and preserves the original event provenance.

Live template sends require a numeric Meta template ID and a recent approval sync. Sync templates again when the configured approval age expires. Mock fixture templates cannot be used for live sending.

Cloud sends require real credentials and a reachable webhook. These external operations cannot be validated in mock mode. Official Meta documentation was not reachable from the restricted build environment; verify current Meta policy/version and complete the live trial before production use.

Text, image, document, audio, and video inbound metadata are supported. Media is represented safely in the conversation; authenticated media download/storage and advanced header/button template parameters are remaining extensions. Campaigns currently support approved text templates with numbered body variables and optional static text headers. Media headers, variable headers, named variables, and parameterized buttons are rejected with an explanation.

## Campaigns and the worker

Create a campaign, choose a saved segment or filters, choose a permitted template, map variables, preview rendered examples, send an authorized test, review exclusions, and type the displayed confirmation. Send now or schedule.

Recipients are snapshotted transactionally. Every recipient must be active, unarchived, opted in, not opted out or do-not-contact, and have a valid unique normalized number. The worker checks eligibility again immediately before sending. A template or provider change invalidates the prior preview/test. Duplicate launch requests cannot duplicate recipients.

The PostgreSQL queue claims work with `FOR UPDATE SKIP LOCKED`, uses bounded batches, a shared send-rate clock, controlled pause/resume/cancel transitions, and retries only explicit transient rejections. No bulk send runs inside a browser request.

**External exactly-once delivery is not guaranteed by the Meta API.** Before calling the provider, the worker records an attempted marker. If it crashes or receives an ambiguous network result after that point, the recipient is marked for manual review after the lease expires rather than blindly resent. Check provider records before choosing any manual resend. Claims that provably never attempted a send are safely recovered. Cancellation stops future unsent work; an already in-flight request can finish.

Run the worker as a supervised long-lived process, separate from Next.js. It needs the same database and WhatsApp configuration. Graceful SIGINT/SIGTERM stops after current work. Cloud deployments using serverless web hosting still need a continuously running worker host.

Campaign reports show sent, delivered, read, failed, replied, interested, and order-confirmed counts. Reply attribution first uses an explicit message context, then the latest eligible recent campaign. It does not infer intent. Staff classify outcomes and may record a lightweight order reference/amount/note; no invoice or inventory logic is present.

## Database and migrations

```sh
npm run db:generate
npm run db:migrate
npm run db:seed        # development and mock mode only
```

The checked-in initial migration creates relationships, constraints, deliberate indexes, and Better Auth session/account/rate-limit tables. Password hashes live in Better Auth's `Account.password`; they are not duplicated on `User`.

`scripts/prisma.ts` uses Prisma's matching official JavaScript generator and WebAssembly schema engine. This avoids a separate native engine download on restricted runners while retaining npm artifact integrity checks and Prisma's migration history/checksums. Internal Prisma packages are pinned together. Validate this helper when upgrading Prisma. Standard `npm run db:dev -- --name <change>` is also available where Prisma's native engine download host is accessible. Never run development migration/reset commands against production.

## Validation

Use a dedicated local mock database. Integration/browser tests create and remove their own fixtures; do not point them at production. Stop any separately running worker before the integration/browser suites so it cannot claim their queued fixtures. The campaign browser test starts and stops its own worker.

```sh
npm run typecheck
npm run lint
npm run test
npm run test:integration
npm run test:e2e
npm run build
npm run start
```

Browser tests use system Chromium if available, otherwise Playwright's installed Chromium. Set `CHROMIUM_PATH` or run `npx playwright install chromium` where browser downloads are permitted. Seed the development database first. The Playwright runner can reuse the existing development server.

See `docs/implementation-log.md` for verification evidence and remaining external checks.

## Production deployment

1. Provision private PostgreSQL with encrypted backups and TLS; apply committed migrations.
2. Inject a unique `AUTH_SECRET`, production `DATABASE_URL`, and exact HTTPS `APP_URL` through your host's secret manager. Do not copy the development `.env` or seed database.
3. Install locked dependencies, generate Prisma Client, and run `npm run build`.
4. For an empty database, securely inject `ADMIN_EMAIL`, `ADMIN_NAME`, and a random `ADMIN_PASSWORD` of at least 16 characters, then run `npm run admin:create`. Remove bootstrap variables afterward. This command refuses to run once an active administrator exists.
5. Run `npm run start` and `npm run worker` under a supervisor. Restrict database access to application/backup hosts.
6. Terminate TLS at a trusted reverse proxy, reject oversized requests (allow the documented import limit), and forward the correct origin. Authentication uses HttpOnly SameSite cookies, secure cookies in production, and persistent login throttling.
7. Review retention/access controls for customer data, import files, message metadata, audit records, and webhook events. Restrict log access and configure service monitoring.
8. Complete a live Meta integration trial before mass sending. Use the confirmation/test workflow and your account's permitted send rate.

### Backups

For the local Compose database:

```sh
mkdir -p .local/backups
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > .local/backups/wbadmin.dump
```

Store production backups encrypted outside the application host, retain an appropriate history, and test restores into an isolated database. `pg_restore --clean` is destructive; never run it against an occupied production database without a reviewed recovery procedure. Database contents and uploaded/imported data are confidential.

## Project layout

`src/app` contains routes and pages, `src/modules` contains domain services and feature UI, `src/lib` holds authentication/database/error boundaries, `prisma` holds schema/migrations/fixtures, and `src/worker.ts` is the separate worker entrypoint. See `docs/architecture.md` for key decisions.
