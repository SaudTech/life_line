// seed-doctors.mjs - inserts a few starter doctors for local development.
//
// Idempotent-ish: skips insertion if any doctor already exists, so re-running
// won't pile up duplicates. Uses the first location as location_id (every core
// table carries one - plan §2). Fees are stored as integer paise.
//
// Usage: node --env-file=.env scripts/seed-doctors.mjs

import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("\n✗ DATABASE_URL is not set.\n");
  process.exit(1);
}

// name, department, fee in paise, revisit validity (days)
const DOCTORS = [
  ["Dr. Anita Rao", "Cardiologist", 50000, 14],
  ["Dr. Rajesh Menon", "General Physician", 30000, 7],
  ["Dr. Priya Nair", "Pediatrician", 40000, 10],
];

const client = new pg.Client({ connectionString });

try {
  await client.connect();

  const { rows: locs } = await client.query(
    "SELECT id FROM locations ORDER BY id ASC LIMIT 1",
  );
  if (locs.length === 0) {
    console.error("\n✗ No location found - seed a location first.\n");
    process.exit(1);
  }
  const locationId = locs[0].id;

  const { rows: existing } = await client.query(
    "SELECT count(*)::int AS n FROM doctors",
  );
  if (existing[0].n > 0) {
    console.log(`\n✓ ${existing[0].n} doctor(s) already present - skipping seed.\n`);
    process.exit(0);
  }

  for (const [name, department, fee_paise, days] of DOCTORS) {
    await client.query(
      `INSERT INTO doctors (name, department, fee_paise, revisit_validity_days, location_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [name, department, fee_paise, days, locationId],
    );
    console.log(`  + ${name} (${department}) - ₹${(fee_paise / 100).toFixed(2)}, ${days} days`);
  }

  console.log(`\n✓ Seeded ${DOCTORS.length} doctors.\n`);
} catch (err) {
  console.error(`\n✗ ${err.message}\n`);
  process.exit(1);
} finally {
  await client.end();
}
