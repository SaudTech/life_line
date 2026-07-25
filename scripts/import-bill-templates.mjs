// import-bill-templates.mjs - loads bill_templates from a JSON file produced
// by export-bill-templates.mjs into THIS database, against its own location.
//
// Must be run after the target server has started at least once (first-run
// needs to have created the location row - see first-run/ensure-first-run.ts).
//
// For each template in the file, any existing ACTIVE row of the same
// bill_type at this location is deactivated (never updated-in-place, same
// pattern the app itself uses - see migration 0010's note) and a fresh active
// row is inserted. Safe to re-run.
//
// Usage:
//   node --env-file=.env scripts/import-bill-templates.mjs <input-file>

import { readFileSync } from "node:fs";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("\n✗ DATABASE_URL is not set.\n");
  process.exit(1);
}

const inputFile = process.argv[2];
if (!inputFile) {
  console.error("\n✗ Usage: node --env-file=.env scripts/import-bill-templates.mjs <input-file>\n");
  process.exit(1);
}

const templates = JSON.parse(readFileSync(inputFile, "utf8"));

const client = new pg.Client({ connectionString });

try {
  await client.connect();

  const { rows: locs } = await client.query(
    "SELECT id FROM locations ORDER BY id ASC LIMIT 1",
  );
  if (locs.length === 0) {
    console.error(
      "\n✗ No location found. Start the server once first (first-run creates it), then re-run this.\n",
    );
    process.exit(1);
  }
  const locationId = locs[0].id;

  await client.query("BEGIN");

  for (const { bill_type, name, schema_json } of templates) {
    await client.query(
      `UPDATE bill_templates SET is_active = false
        WHERE location_id = $1 AND bill_type = $2 AND is_active`,
      [locationId, bill_type],
    );
    await client.query(
      `INSERT INTO bill_templates (location_id, bill_type, name, schema_json, is_active)
       VALUES ($1, $2, $3, $4, true)`,
      [locationId, bill_type, name, JSON.stringify(schema_json)],
    );
    console.log(`  + ${bill_type}: "${name}"`);
  }

  await client.query("COMMIT");
  console.log(`\n✓ Imported ${templates.length} template(s) for location ${locationId}.\n`);
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  console.error(`\n✗ ${err.message}\n`);
  process.exit(1);
} finally {
  await client.end();
}
