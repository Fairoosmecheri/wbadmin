import "dotenv/config";
import { spawnSync } from "node:child_process";
import { existsSync, openSync, closeSync, mkdirSync, renameSync, chmodSync } from "node:fs";
import pg from "pg";

// Local onboarding databases only. This script never replaces an existing schema.
if (process.env.NODE_ENV === "production" || process.env.WHATSAPP_MODE !== "mock") throw new Error("Cloud demo database setup requires a non-production mock environment.");
const url = new URL(process.env.DATABASE_URL || "postgresql://missing");
if (!["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Use your external database's normal deployment workflow instead of the local cloud helper.");
if (decodeURIComponent(url.pathname.slice(1)) !== process.env.POSTGRES_DB || decodeURIComponent(url.username) !== process.env.POSTGRES_USER || (url.port && url.port !== "5432")) {
  throw new Error("DATABASE_URL must match the local Compose database, user, and port before using this helper.");
}
function run(args, options = {}) {
  const result = spawnSync("docker", ["compose", ...args], { stdio: "inherit", ...options });
  if (result.status !== 0) throw new Error("Local PostgreSQL command failed.");
}
run(["up", "-d", "--wait", "db"]);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const backup = ".local/database.dump";
try {
  if (process.argv[2] === "backup") {
    mkdirSync(".local", { recursive: true });
    const fd = openSync(`${backup}.tmp`, "w", 0o600);
    try { run(["exec", "-T", "db", "sh", "-c", 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc'], { stdio: ["ignore", fd, "inherit"] }); }
    finally { closeSync(fd); }
    renameSync(`${backup}.tmp`, backup); chmodSync(backup, 0o600);
    console.info("Saved ignored development database backup for environment restoration.");
  } else {
    const result = await pool.query("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'");
    if (result.rows[0].count === 0 && existsSync(backup)) {
      const fd = openSync(backup, "r");
      try { run(["exec", "-T", "db", "sh", "-c", 'pg_restore --exit-on-error --single-transaction --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB"'], { stdio: [fd, "inherit", "inherit"] }); }
      finally { closeSync(fd); }
      console.info("Restored the development snapshot into an empty database.");
    } else console.info("Existing database preserved; PostgreSQL is ready.");
  }
} finally { await pool.end(); }
