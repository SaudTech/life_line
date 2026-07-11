// seed-services.mjs - inserts a rich starter services catalog for local
// development and testing (plan §5d).
//
// IP discharge expenses are CATALOG-ONLY (no free-text), so the catalog must be
// wide enough to cover the real ward/OPD range - injections, dressings, room/bed
// per-day charges, nursing, diagnostics, sundries - so totals, discounts, and
// refund math get a real workout. Prices are realistic and varied (₹50 - ₹5,000).
//
// Idempotent per item: inserts only services whose name isn't already present, so
// re-running TOPS UP the catalog with any new items and never piles up duplicates
// (existing rows/prices are left untouched). Uses the first location as
// location_id (every core table carries one). Prices are stored as integer paise.
//
// Usage: node --env-file=.env scripts/seed-services.mjs

import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("\n✗ DATABASE_URL is not set.\n");
  process.exit(1);
}

// name, price in paise (₹ × 100)
const SERVICES = [
  // Injections / IV
  ["IV Fluids (DNS)", 12000],
  ["IV Fluids (NS)", 12000],
  ["IM Injection", 8000],
  ["IV Antibiotic Dose", 25000],
  ["Insulin Dose", 5000],
  // Dressings / minor procedures
  ["Small Dressing", 10000],
  ["Large Dressing", 20000],
  ["Suturing", 60000],
  ["Catheterisation", 45000],
  ["Nebulisation", 15000],
  ["Oxygen (per hour)", 20000],
  // Room / bed (per day)
  ["General Ward Bed (per day)", 80000],
  ["Semi-Private Room (per day)", 150000],
  ["Private Room (per day)", 300000],
  ["ICU Bed (per day)", 500000],
  // Nursing / care
  ["Nursing Charge (per day)", 40000],
  ["Monitoring Charge", 25000],
  ["Physiotherapy Session", 35000],
  // Diagnostics
  ["ECG", 30000],
  ["X-Ray", 40000],
  ["Blood Sugar", 8000],
  ["CBC", 25000],
  ["Urine Routine", 15000],
  // Procedures / sundries
  ["Dressing Tray", 12000],
  ["Consumables Kit", 18000],
  ["Ambulance", 100000],
  ["Medical Certificate", 20000],
  // A few more OPD items so the picker is well stocked
  ["Injection (Consumable)", 6000],
  ["Wound Cleaning", 9000],
  ["Plaster (POP)", 70000],
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

  // Per-item idempotent: insert only services whose name isn't already present
  // (case-insensitive), so a re-run TOPS UP the catalog with any new items rather
  // than skipping wholesale. Existing rows (and their prices) are left untouched.
  const { rows: existing } = await client.query("SELECT name FROM services");
  const present = new Set(existing.map((r) => r.name.trim().toLowerCase()));

  let added = 0;
  for (const [name, price_paise] of SERVICES) {
    if (present.has(name.trim().toLowerCase())) continue;
    await client.query(
      `INSERT INTO services (name, price_paise, location_id) VALUES ($1, $2, $3)`,
      [name, price_paise, locationId],
    );
    console.log(`  + ${name} - ₹${(price_paise / 100).toFixed(2)}`);
    added += 1;
  }

  if (added === 0) {
    console.log(`\n✓ Catalog already has all ${SERVICES.length} seed services - nothing to add.\n`);
  } else {
    console.log(`\n✓ Added ${added} service(s) (${present.size} already present, left untouched).\n`);
  }
} catch (err) {
  console.error(`\n✗ ${err.message}\n`);
  process.exit(1);
} finally {
  await client.end();
}
