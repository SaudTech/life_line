// export-bill-templates.mjs - dumps the currently ACTIVE bill_templates (the
// pdfme receipt layouts designed in the admin UI) to a JSON file, so they can
// be carried over to a different install's database.
//
// Deliberately does NOT export id, location_id, or updated_by - those are
// specific to this database (updated_by is a UUID FK to a local user row that
// won't exist on the target DB). Only the portable design fields are kept.
//
// Usage:
//   node --env-file=.env scripts/export-bill-templates.mjs [output-file]
//   (default output file: bill-templates-export.json)

import { writeFileSync } from "node:fs";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("\n✗ DATABASE_URL is not set.\n");
  process.exit(1);
}

const outputFile = process.argv[2] || "bill-templates-export.json";

const client = new pg.Client({ connectionString });

try {
  await client.connect();

  const { rows } = await client.query(
    `SELECT bill_type, name, schema_json
       FROM bill_templates
      WHERE is_active
      ORDER BY bill_type`,
  );

  if (rows.length === 0) {
    console.log("\n✗ No active bill templates found - nothing to export.\n");
    process.exit(0);
  }

  writeFileSync(outputFile, JSON.stringify(rows, null, 2), "utf8");

  console.log(`\n✓ Exported ${rows.length} active template(s) to ${outputFile}:`);
  for (const r of rows) {
    console.log(`  - ${r.bill_type}: "${r.name}"`);
  }
  console.log();
} catch (err) {
  console.error(`\n✗ ${err.message}\n`);
  process.exit(1);
} finally {
  await client.end();
}
