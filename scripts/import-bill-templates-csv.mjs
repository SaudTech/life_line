// import-bill-templates-csv.mjs - loads bill_templates from a raw CSV table
// export (columns: id, location_id, bill_type, name, schema_json, is_active,
// updated_at, updated_by) into THIS database, against its own location.
//
// id, location_id, and updated_by from the CSV are ignored - they're specific
// to the database the CSV was exported from (updated_by is a UUID FK to a user
// row that won't exist here). Only ACTIVE rows are imported: for each bill_type,
// any existing active row at this location is deactivated (never updated in
// place - same pattern the app itself uses, see migration 0010) and a fresh
// active row is inserted from the CSV's schema_json/name. Safe to re-run.
//
// Usage:
//   node --env-file=.env scripts/import-bill-templates-csv.mjs <csv-file>

import { readFileSync } from "node:fs";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("\n✗ DATABASE_URL is not set.\n");
  process.exit(1);
}

const inputFile = process.argv[2];
if (!inputFile) {
  console.error("\n✗ Usage: node --env-file=.env scripts/import-bill-templates-csv.mjs <csv-file>\n");
  process.exit(1);
}

// Minimal RFC4180 CSV parser: handles quoted fields, "" as an escaped quote,
// commas and newlines inside quoted fields (schema_json is one big quoted
// field). Returns an array of rows, each an array of string cells.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (c === "\r") {
      i += 1;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const raw = readFileSync(inputFile, "utf8");
const rows = parseCsv(raw);
if (rows.length < 2) {
  console.error("\n✗ CSV has no data rows.\n");
  process.exit(1);
}

const header = rows[0];
const col = (name) => {
  const idx = header.indexOf(name);
  if (idx === -1) throw new Error(`CSV is missing expected column "${name}"`);
  return idx;
};
const idxBillType = col("bill_type");
const idxName = col("name");
const idxSchemaJson = col("schema_json");
const idxIsActive = col("is_active");

const records = rows.slice(1).filter((r) => r.length === header.length);
const activeRecords = records.filter((r) => /^t(rue)?$/i.test(r[idxIsActive].trim()));

if (activeRecords.length === 0) {
  console.log("\n✗ No active rows found in the CSV - nothing to import.\n");
  process.exit(0);
}

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

  for (const r of activeRecords) {
    const billType = r[idxBillType];
    const name = r[idxName];
    let schemaJson;
    try {
      schemaJson = JSON.parse(r[idxSchemaJson]);
    } catch {
      throw new Error(`Row for bill_type "${billType}" has invalid schema_json JSON`);
    }

    await client.query(
      `UPDATE bill_templates SET is_active = false
        WHERE location_id = $1 AND bill_type = $2 AND is_active`,
      [locationId, billType],
    );
    await client.query(
      `INSERT INTO bill_templates (location_id, bill_type, name, schema_json, is_active)
       VALUES ($1, $2, $3, $4, true)`,
      [locationId, billType, name, JSON.stringify(schemaJson)],
    );
    console.log(`  + ${billType}: "${name}"`);
  }

  await client.query("COMMIT");
  console.log(`\n✓ Imported ${activeRecords.length} active template(s) for location ${locationId}.\n`);
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  console.error(`\n✗ ${err.message}\n`);
  process.exit(1);
} finally {
  await client.end();
}
