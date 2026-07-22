// seed-stress-patients.mjs - generate a huge synthetic patient pool (default
// 2,00,000) for stress/perf testing search, pagination, and reports.
//
// Every generated name starts with the PREFIX below ("ZZTEST ") so the whole
// batch is trivially identifiable and deletable later. This script creates
// ONLY patient rows - no bills/consultations - so cleanup is a single DELETE.
//
// Inserts run in batches of 1,000 via UNNEST (one round-trip per 1,000 rows),
// so 2 lakh rows land in well under a minute on a local Postgres.
//
// Usage:
//   node --env-file=.env scripts/seed-stress-patients.mjs            # insert 200000
//   node --env-file=.env scripts/seed-stress-patients.mjs 50000      # insert 50000
//   node --env-file=.env scripts/seed-stress-patients.mjs --delete   # remove them all

import pg from "pg";

const PREFIX = "ZZTEST ";
const BATCH = 1000;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("\n✗ DATABASE_URL is not set.\n");
  process.exit(1);
}

const client = new pg.Client({ connectionString });

// --- name pools (combinations give ~10k distinct names; repeats are fine and
// realistic - plenty of real patients share a name, which is exactly why the
// system identifies by patient_code, not name/phone) ------------------------
const FIRST = [
  "Aarav", "Abdul", "Aditya", "Amit", "Anand", "Anil", "Arjun", "Ashok",
  "Deepak", "Dinesh", "Farhan", "Ganesh", "Gopal", "Harish", "Imran", "Karan",
  "Karthik", "Kiran", "Mahesh", "Manoj", "Mohan", "Naveen", "Nikhil", "Pavan",
  "Prakash", "Rahul", "Rajesh", "Rakesh", "Ramesh", "Ravi", "Rohit", "Sanjay",
  "Santosh", "Sathish", "Shiva", "Srinivas", "Suresh", "Venkatesh", "Vijay", "Vikram",
  "Aisha", "Anita", "Anjali", "Asha", "Bhavani", "Deepa", "Divya", "Farida",
  "Geeta", "Jyoti", "Kavita", "Lakshmi", "Madhavi", "Meena", "Nandini", "Padma",
  "Pooja", "Priya", "Priyanka", "Radha", "Rekha", "Sana", "Sangeeta", "Saroja",
  "Shruti", "Sita", "Sneha", "Sunita", "Swathi", "Uma", "Vani", "Zainab",
];
const LAST = [
  "Sharma", "Reddy", "Rao", "Kumar", "Nair", "Patil", "Verma", "Gupta",
  "Khan", "Ali", "Begum", "Sheikh", "Das", "Menon", "Iyer", "Chowdary",
  "Naidu", "Goud", "Yadav", "Singh", "Prasad", "Murthy", "Shetty", "Pillai",
  "Devi", "Bai", "Joshi", "Kulkarni", "Mishra", "Agarwal",
];
const AREAS = [
  "Ameerpet", "Kondapur", "Mehdipatnam", "KPHB", "Uppal", "Malakpet",
  "Santoshnagar", "Manikonda", "Begumpet", "Nampally", "Kukatpally", "Alwal",
  "Yakutpura", "Kompally", "Nizampet", "Dilsukhnagar", "LB Nagar", "Tolichowki",
  "Secunderabad", "Charminar", "Gachibowli", "Miyapur", "Attapur", "Chandrayangutta",
];

const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

try {
  await client.connect();

  // --- delete mode ---------------------------------------------------------
  if (process.argv.includes("--delete")) {
    const t0 = Date.now();
    const { rowCount } = await client.query(
      "DELETE FROM patients WHERE name LIKE $1",
      [PREFIX + "%"],
    );
    console.log(`\n✓ Deleted ${rowCount.toLocaleString("en-IN")} '${PREFIX}' patients in ${((Date.now() - t0) / 1000).toFixed(1)}s.\n`);
    process.exit(0);
  }

  const TOTAL = Number(process.argv[2]) || 200000;

  const { rows: locs } = await client.query(
    "SELECT id FROM locations ORDER BY id ASC LIMIT 1",
  );
  if (locs.length === 0) {
    console.error("\n✗ No location - run the app's first-run setup first.\n");
    process.exit(1);
  }
  const locationId = locs[0].id;

  const { rows: existing } = await client.query(
    "SELECT count(*)::int n FROM patients WHERE name LIKE $1",
    [PREFIX + "%"],
  );
  if (existing[0].n > 0) {
    console.log(`\nNote: ${existing[0].n.toLocaleString("en-IN")} '${PREFIX}' patients already exist; adding ${TOTAL.toLocaleString("en-IN")} more.`);
  }

  console.log(`\nInserting ${TOTAL.toLocaleString("en-IN")} patients (prefix '${PREFIX}', batches of ${BATCH})...`);
  const t0 = Date.now();
  const nowMs = Date.now();
  const spreadMs = 548 * 24 * 60 * 60 * 1000; // registrations spread over ~18 months

  let inserted = 0;
  while (inserted < TOTAL) {
    const n = Math.min(BATCH, TOTAL - inserted);
    const names = [], ages = [], genders = [], phones = [], areas = [], createdAts = [];
    for (let i = 0; i < n; i++) {
      const gender = Math.random() < 0.5 ? "male" : "female";
      names.push(`${PREFIX}${rand(FIRST)} ${rand(LAST)}`);
      ages.push(randInt(0, 90));
      genders.push(gender);
      // 10-digit Indian mobile; ~3% get a repeated "family" number so the
      // shared-phone lookup path (mother + child) is exercised at scale too.
      phones.push(
        Math.random() < 0.03
          ? `98999${String(randInt(0, 99999)).padStart(5, "0")}`
          : `${rand(["6", "7", "8", "9"])}${String(randInt(0, 999999999)).padStart(9, "0")}`,
      );
      areas.push(rand(AREAS));
      createdAts.push(new Date(nowMs - Math.random() * spreadMs).toISOString());
    }
    await client.query(
      `INSERT INTO patients (name, age, gender, phone, area, location_id, created_at)
       SELECT * FROM unnest($1::text[], $2::int[], $3::text[], $4::text[], $5::text[],
                            array_fill($6::bigint, ARRAY[$7::int]), $8::timestamptz[])`,
      [names, ages, genders, phones, areas, locationId, n, createdAts],
    );
    inserted += n;
    if (inserted % 20000 === 0 || inserted === TOTAL) {
      process.stdout.write(`  ${inserted.toLocaleString("en-IN")} / ${TOTAL.toLocaleString("en-IN")}\r\n`);
    }
  }

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const { rows: total } = await client.query("SELECT count(*)::int n FROM patients");
  console.log(`\n✓ Done in ${secs}s. Patients table now has ${total[0].n.toLocaleString("en-IN")} rows.`);
  console.log(`\nTo remove them later:\n  node --env-file=.env scripts/seed-stress-patients.mjs --delete\n`);
} catch (err) {
  console.error(`\n✗ ${err.message}\n`, err);
  process.exit(1);
} finally {
  await client.end();
}
