/**
 * Prisma's official JavaScript client generator and WASM schema engine.
 * Pin these packages together. This avoids a separate native-engine download in
 * restricted cloud runners while retaining npm's artifact integrity checks and
 * Prisma's migration checksums, locking, and history table.
 */
import "dotenv/config";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClientJsGenerator } from "@prisma/client-generator-js";
import { bindMigrationAwareSqlAdapterFactory } from "@prisma/driver-adapter-utils";
import { formatSchema, getGenerators, validate } from "@prisma/internals";
import type { MigrationList, SchemaEngine } from "@prisma/schema-engine-wasm";
import { Pool } from "pg";

const require = createRequire(import.meta.url);
const schemaPath = path.resolve("prisma/schema.prisma");
const migrationsPath = path.resolve("prisma/migrations");

async function loadMigrations(): Promise<MigrationList> {
  const entries = await readdir(migrationsPath, { withFileTypes: true });
  const folders = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  return {
    baseDir: migrationsPath,
    lockfile: { path: "migration_lock.toml", content: await readFile(path.join(migrationsPath, "migration_lock.toml"), "utf8") },
    shadowDbInitScript: "",
    migrationDirectories: await Promise.all(folders.map(async (folder) => ({
      path: folder,
      migrationFile: {
        path: "migration.sql",
        content: { tag: "ok" as const, value: await readFile(path.join(migrationsPath, folder, "migration.sql"), "utf8") },
      },
    }))),
  };
}

async function migrate() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required to apply migrations.");
  const runtime = await import("@prisma/schema-engine-wasm/schema_engine_bg");
  const engineDirectory = path.dirname(require.resolve("@prisma/schema-engine-wasm"));
  const bytes = await readFile(path.join(engineDirectory, "schema_engine_bg.wasm"));
  const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), { "./schema_engine_bg.js": runtime });
  runtime.__wbg_set_wasm(instance.exports);
  (instance.exports.__wbindgen_start as () => void)();
  const pool = new Pool({ connectionString });
  let engine: SchemaEngine | undefined;
  try {
    engine = await runtime.SchemaEngine.new(
      { datamodels: [[schemaPath, await readFile(schemaPath, "utf8")]] },
      () => {},
      bindMigrationAwareSqlAdapterFactory(new PrismaPg(pool)),
    );
    const result = await engine.applyMigrations({
      migrationsList: await loadMigrations(),
      filters: { externalEnums: [], externalTables: [] },
    });
    console.info(result.appliedMigrationNames.length ? `Applied migrations: ${result.appliedMigrationNames.join(", ")}` : "Database migrations are up to date.");
  } finally {
    engine?.free();
    await pool.end();
  }
}

async function main() {
  const command = process.argv[2] ?? "generate";
  if (command === "generate") {
    const generators = await getGenerators({
      schemaPath,
      registry: {
        "prisma-client-js": {
          type: "in-process",
          generator: new PrismaClientJsGenerator({
            cliCommand: "prisma",
            runtimePath: path.join(path.dirname(require.resolve("@prisma/client/package.json")), "runtime"),
          }),
        },
      },
      cliCommand: "prisma",
    });
    try {
      for (const generator of generators) await generator.generate();
      console.info("Prisma Client generated.");
    } finally {
      for (const generator of generators) generator.stop();
    }
  } else if (command === "validate" || command === "format") {
    const schemas: [string, string][] = [[schemaPath, await readFile(schemaPath, "utf8")]];
    validate({ schemas });
    if (command === "format") {
      const formatted = await formatSchema({ schemas });
      await writeFile(schemaPath, formatted[0][1]);
    }
    console.info(`Prisma schema ${command === "format" ? "formatted and validated" : "validated"}.`);
  } else if (command === "migrate") {
    await migrate();
  } else {
    throw new Error("Usage: tsx scripts/prisma.ts generate|validate|format|migrate");
  }
}

main().catch((error: unknown) => {
  // Do not include datasource URLs, which may contain credentials, in output.
  const message = error instanceof Error ? error.message : "Prisma operation failed.";
  console.error(message.replace(/postgres(?:ql)?:\/\/[^\s]+/g, "[database URL redacted]"));
  process.exitCode = 1;
});
