// migrate.mjs - applies pending SQL migrations, in order, forward-only.
//
// Each file in ../migrations named `NNNN_name.sql` is applied exactly once,
// inside its own transaction, and recorded in the `schema_migrations` table.
// A file's contents are never re-run; to change the schema, add a NEW file.
// Never edit a migration that has already been applied to the clinic DB.
//
// Usage:
//   node --env-file=.env scripts/migrate.mjs          (apply pending)
//   node --env-file=.env scripts/migrate.mjs --status (show state, apply nothing)
//
// Requires DATABASE_URL in the environment (see .env.example).

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const statusOnly = process.argv.includes("--status");

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  fail("DATABASE_URL is not set. Run with: node --env-file=.env scripts/migrate.mjs");
}

// A valid migration filename is `NNNN_description.sql` (e.g. 0001_init.sql).
// Sorting the filenames as strings gives the correct apply order.
const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => /^\d{4}_.+\.sql$/.test(f))
  .sort();

const client = new pg.Client({ connectionString });

try {
  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  const { rows } = await client.query("SELECT filename FROM schema_migrations");
  const applied = new Set(rows.map((r) => r.filename));
  const pending = files.filter((f) => !applied.has(f));

  if (statusOnly) {
    console.log(`\nMigrations in ${MIGRATIONS_DIR}:`);
    for (const f of files) {
      console.log(`  ${applied.has(f) ? "✓ applied" : "· pending"}  ${f}`);
    }
    console.log(`\n${applied.size} applied, ${pending.length} pending.\n`);
    process.exit(0);
  }

  if (pending.length === 0) {
    console.log("\n✓ Database is up to date - no pending migrations.\n");
    process.exit(0);
  }

  for (const filename of pending) {
    const sql = readFileSync(join(MIGRATIONS_DIR, filename), "utf8");
    process.stdout.write(`Applying ${filename} ... `);
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [filename]);
      await client.query("COMMIT");
      console.log("done");
    } catch (err) {
      await client.query("ROLLBACK");
      fail(`Failed on ${filename} (rolled back): ${err.message}`);
    }
  }

  console.log(`\n✓ Applied ${pending.length} migration(s).\n`);
} catch (err) {
  fail(err.message);
} finally {
  await client.end();
}
