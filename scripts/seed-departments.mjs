// seed-departments.mjs - one-off workaround for a fresh-install gap: migration
// 0020's seed INSERT only populates departments if a `locations` row already
// exists at migration time. On a fresh DB (npm run migrate before the server's
// first-run has ever created a location), it silently inserts 0 rows.
//
// Run this after the server has started at least once (so the location
// exists). Idempotent: skips names already present for this location.
//
// Usage: node --env-file=.env scripts/seed-departments.mjs

import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("\n✗ DATABASE_URL is not set.\n");
  process.exit(1);
}

// Same 49 names as migration 0020_departments.sql.
const DEPARTMENTS = [
  "General Physician", "General Surgeon", "Cardiologist",
  "Cardiothoracic Surgeon (CTVS)", "Orthopedician", "Pediatrician",
  "Neonatologist", "Gynecologist", "Obstetrician", "ENT Specialist",
  "Dermatologist (Skin Specialist)", "Cosmetologist", "Neurologist",
  "Neurosurgeon", "Psychiatrist", "Psychologist",
  "Ophthalmologist (Eye Specialist)", "Dentist",
  "Oral & Maxillofacial Surgeon", "Urologist", "Nephrologist",
  "Radiologist", "Anesthetist", "Gastroenterologist",
  "Endocrinologist", "Pulmonologist", "Rheumatologist",
  "Oncologist", "Hematologist", "Plastic Surgeon",
  "Vascular Surgeon", "Emergency Medicine Specialist",
  "Intensivist (Critical Care)", "Physiotherapist",
  "Dietitian / Nutritionist", "Pathologist", "Microbiologist",
  "Family Physician", "Geriatrician", "Sports Medicine Specialist",
  "Pain Management Specialist", "Diabetologist", "Andrologist",
  "Infectious Disease Specialist", "Allergist / Immunologist",
  "Homeopath", "Ayurvedic Doctor", "Physiatrist (Rehabilitation)",
  "Other",
];

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

  const { rows: existing } = await client.query(
    "SELECT name FROM departments WHERE location_id = $1",
    [locationId],
  );
  const present = new Set(existing.map((r) => r.name));

  let added = 0;
  for (const name of DEPARTMENTS) {
    if (present.has(name)) continue;
    await client.query(
      `INSERT INTO departments (location_id, name) VALUES ($1, $2)`,
      [locationId, name],
    );
    added += 1;
  }

  if (added === 0) {
    console.log(`\n✓ All ${DEPARTMENTS.length} default departments already present - nothing to add.\n`);
  } else {
    console.log(`\n✓ Added ${added} department(s) for location ${locationId}.\n`);
  }
} catch (err) {
  console.error(`\n✗ ${err.message}\n`);
  process.exit(1);
} finally {
  await client.end();
}
