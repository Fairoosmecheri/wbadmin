# Cloud environment startup

Use the existing checkout at `/workspace/wbadmin`. Each cloud task is already isolated; do not create a Git worktree unless the user explicitly requests one.

Prepared files and dependencies can survive a snapshot. Database/server/worker processes must be started again. Docker volumes may live outside the filesystem snapshot, so `.local/database.dump` is an ignored development backup that can restore into an empty local database. Existing databases are never overwritten by the helper.

From `/workspace/wbadmin`:

```sh
npm run setup:local
node scripts/cloud-db.mjs
npm run db:generate
npm run db:migrate
npm run db:seed
```

For a fresh checkout run `npm ci` first. Docker must be running with the Compose plugin available. These are development instructions for the local PostgreSQL/mock setup. The helper requires the loopback `DATABASE_URL` database name, user, and port to match the Compose configuration. Keep existing `.env` values private. For an external or production database follow README deployment instructions instead of the cloud helper.

Start two long-lived terminal sessions:

```sh
npm run dev
```

```sh
npm run worker
```

Check the database health with `docker compose ps`. Internally request `/login` and confirm it returns the sign-in form; unauthenticated `/api/customers` must return 401. Authenticate the seeded development administrator and verify `/dashboard` and `/api/customers`. The README lists the development-only login. Do not create public preview links for loopback addresses in the onboarding UI.

Keep WhatsApp in mock mode during development. Test campaign recipients progress through the worker to sent/delivered/read and a mock incoming reply. Unit/integration tests and browser tests are documented in README. Stop separately running workers before integration and browser tests, since they can claim queued fixtures; the campaign browser test manages its own worker. Restart the development worker after validation.

After a deliberate development milestone, refresh the snapshot backup:

```sh
node scripts/cloud-db.mjs backup
```

This does not publish the environment. Review/save the draft in environment settings and publish through the product when ready. A saved draft or successful local test does not verify restoration in a fresh task.
