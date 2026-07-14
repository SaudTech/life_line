// seed-bulk.mjs - a large, realistic top-up dataset on top of seed-demo, for a
// hospital-scale local demo. Adds many patients, OPD consultations (some EXPIRED,
// some valid today), OPD procedure bills, several CURRENTLY-ADMITTED in-patients,
// and discharged IP admissions with their bills - all across cash/card/upi/other,
// with amounts a small nursing home would actually see (today's collections land
// around ₹30-40k).
//
// Also assigns the two desk staff to a supervisor so the supervisor "My team" and
// "Bills today" screens have real data to show.
//
// Idempotent: keyed on a SENTINEL patient (Rohit Sharma / 9899900001). If that
// patient already exists, the money seed is skipped so a re-run never duplicates
// receipts. Safe to run repeatedly.
//
// Usage: node --env-file=.env scripts/seed-bulk.mjs

import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("\n✗ DATABASE_URL is not set.\n");
  process.exit(1);
}

const client = new pg.Client({ connectionString });

// Anchor around the project's "today" so the daily report + charts read as a
// believable recent window. Fixed (not new Date()) so re-seeds are stable.
const TODAY = new Date("2026-07-13T10:00:00.000Z");
function dayAt(offset, hour = 11, min = 0) {
  const d = new Date(TODAY);
  d.setUTCDate(d.getUTCDate() + offset);
  // Keep UTC hour <= 17 so the instant stays inside the SAME clinic day in IST
  // (clinic day = Asia/Kolkata; 18:30 UTC is the next IST midnight).
  d.setUTCHours(Math.min(hour, 17), min, 0, 0);
  return d.toISOString();
}
function addDays(iso, days) {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

try {
  await client.connect();

  const { rows: locs } = await client.query(
    "SELECT id FROM locations ORDER BY id ASC LIMIT 1",
  );
  if (locs.length === 0) {
    console.error("\n✗ No location - run the app's first-run setup first.\n");
    process.exit(1);
  }
  const locationId = locs[0].id;

  const { rows: users } = await client.query("SELECT id, name, role FROM users WHERE active");
  const byRole = (r) => {
    const u = users.find((x) => x.role === r);
    if (!u) throw new Error(`No active ${r} user - seed users first.`);
    return u.id;
  };
  const opDesk = byRole("op_desk");
  const opIp = byRole("op_ip_desk");
  const supervisor = byRole("supervisor");

  const { rows: doctors } = await client.query(
    "SELECT id, name, fee_paise, revisit_validity_days FROM doctors ORDER BY id",
  );
  const doc = (nameFragment) => {
    const d = doctors.find((x) => x.name.includes(nameFragment));
    if (!d) throw new Error(`Doctor matching "${nameFragment}" not found.`);
    return d;
  };
  const { rows: services } = await client.query("SELECT id, name, price_paise FROM services");
  const svc = (name) => {
    const matches = services.filter((x) => x.name.toLowerCase() === name.toLowerCase());
    if (matches.length === 0) throw new Error(`Service "${name}" not found - run seed:services.`);
    return matches[0];
  };
  const price = (name) => Number(svc(name).price_paise);

  // --- assign the desk staff to a supervisor (idempotent) ------------------
  await client.query(`UPDATE users SET supervisor_id = $1 WHERE id IN ($2, $3)`, [
    supervisor,
    opDesk,
    opIp,
  ]);
  console.log(`✓ Supervisor link: desk staff report to "${users.find((u) => u.id === supervisor).name}".`);

  // --- patients (idempotent top-up) ---------------------------------------
  // name, age, gender, phone, area. "Baby of Divya" shares Divya's phone (a
  // newborn under the mother's number - phone is a lookup, not an identity).
  const PATIENTS = [
    ["Rohit Sharma", 41, "male", "9899900001", "Ameerpet"],
    ["Deepa Nair", 34, "female", "9899900002", "Kondapur"],
    ["Abdul Rahman", 55, "male", "9899900003", "Mehdipatnam"],
    ["Priyanka Das", 28, "female", "9899900004", "KPHB"],
    ["Venkatesh Rao", 63, "male", "9899900005", "Uppal"],
    ["Meena Kumari", 47, "female", "9899900006", "Malakpet"],
    ["Sana Sheikh", 5, "female", "9899900007", "Santoshnagar"],
    ["Karthik Nair", 36, "male", "9899900008", "Manikonda"],
    ["Rekha Sharma", 52, "female", "9899900009", "Begumpet"],
    ["Imran Ali", 44, "male", "9899900010", "Nampally"],
    ["Divya Menon", 31, "female", "9899900011", "Kukatpally"],
    ["Baby of Divya", 0, "female", "9899900011", "Kukatpally"],
    ["Ganesh Patil", 59, "male", "9899900012", "Alwal"],
    ["Farida Begum", 38, "female", "9899900013", "Yakutpura"],
    ["Aditya Verma", 26, "male", "9899900014", "Kompally"],
    ["Shruti Rao", 33, "female", "9899900015", "Nizampet"],
  ];

  // Idempotency sentinel.
  const { rows: sentinel } = await client.query(
    "SELECT id FROM patients WHERE name = $1 AND phone = $2 LIMIT 1",
    ["Rohit Sharma", "9899900001"],
  );
  if (sentinel.length > 0) {
    console.log("\n✓ Bulk data already present (Rohit Sharma exists) - nothing to add.\n");
    process.exit(0);
  }

  const patientId = {};
  for (const [name, age, gender, phone, area] of PATIENTS) {
    const { rows: ins } = await client.query(
      `INSERT INTO patients (name, age, gender, phone, area, location_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [name, age, gender, phone, area, locationId, dayAt(-22, 9)],
    );
    patientId[name] = ins[0].id;
  }
  console.log(`✓ Patients: ${PATIENTS.length} added.`);

  // --- helpers -------------------------------------------------------------
  async function makeBill({
    patient, type, items, discount = 0, paymentMode = "cash",
    status = "final", createdBy, createdAt, admissionId = null,
    consultationId = null, discountApprovedBy = null, voided = null,
  }) {
    const subtotal = items.reduce((s, it) => s + it.qty * it.unit, 0);
    const total = subtotal - discount;
    const { rows } = await client.query(
      `INSERT INTO bills
        (patient_id, type, subtotal_paise, discount_paise, total_paise, status,
         payment_mode, discount_approved_by, created_by, created_at,
         admission_id, consultation_id, voided_by, voided_at, void_reason, location_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING id`,
      [
        patientId[patient], type, subtotal, discount, total, status,
        paymentMode, discountApprovedBy, createdBy, createdAt, admissionId, consultationId,
        voided?.by ?? null, voided?.at ?? null, voided?.reason ?? null, locationId,
      ],
    );
    const billId = rows[0].id;
    for (const it of items) {
      await client.query(
        `INSERT INTO bill_items
          (bill_id, service_id, description, quantity, unit_price_paise, line_total_paise)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [billId, it.serviceId ?? null, it.desc, it.qty, it.unit, it.qty * it.unit],
      );
    }
    return total;
  }

  async function makeConsult({ patient, doctorFragment, offset, hour = 10, reason, createdBy, paymentMode }) {
    const d = doc(doctorFragment);
    const createdAt = dayAt(offset, hour, 15);
    const validUntil = addDays(createdAt, d.revisit_validity_days);
    const { rows } = await client.query(
      `INSERT INTO consultations
        (patient_id, doctor_id, fee_charged_paise, valid_until, reason, location_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [patientId[patient], d.id, d.fee_paise, validUntil, reason, locationId, createdAt],
    );
    return makeBill({
      patient, type: "consultation", consultationId: rows[0].id,
      items: [{ desc: `Consultation - ${d.name}`, qty: 1, unit: Number(d.fee_paise) }],
      paymentMode, createdBy, createdAt,
    });
  }

  // item shorthand: [serviceName, qty]
  const line = ([name, qty]) => ({ serviceId: svc(name).id, desc: name, qty, unit: price(name) });

  // ── 1) Consultations - a week+ of OPD, incl. EXPIRED and today's ─────────
  // [patient, doctorFragment, offset, hour, reason, createdBy, paymentMode]
  const consults = [
    // EXPIRED (created long enough ago that valid_until < today):
    ["Venkatesh Rao", "Rajesh", -20, 9, "Cough and cold", opDesk, "cash"],   // 7d validity → expired
    ["Rekha Sharma", "Priya", -15, 10, "Knee pain", opDesk, "upi"],          // 10d → expired
    ["Ganesh Patil", "Anita", -18, 11, "Chest tightness", opIp, "card"],     // 14d → expired
    ["Imran Ali", "Rajesh", -12, 10, "Acidity", opDesk, "cash"],             // 7d → expired
    // Still-valid earlier this week:
    ["Deepa Nair", "Priya", -6, 12, "Ante-natal check-up", opIp, "cash"],
    ["Abdul Rahman", "Anita", -4, 9, "Blood pressure review", opDesk, "card"],
    ["Meena Kumari", "Rajesh", -3, 15, "Migraine", opDesk, "upi"],
    ["Sana Sheikh", "Priya", -2, 11, "Child fever", opIp, "cash"],
    ["Farida Begum", "Rajesh", -1, 16, "Diabetes follow-up", opDesk, "cash"],
    // TODAY:
    ["Aditya Verma", "Anita", 0, 9, "Palpitations", opDesk, "cash"],
    ["Shruti Rao", "Priya", 0, 10, "Ante-natal check-up", opIp, "upi"],
    ["Karthik Nair", "Rajesh", 0, 11, "Fever and cough", opDesk, "card"],
    ["Rohit Sharma", "Anita", 0, 12, "Follow-up ECG review", opDesk, "cash"],
    ["Priyanka Das", "Rajesh", 0, 13, "Throat infection", opIp, "other"],
  ];
  let todayCollected = 0;
  for (const [patient, d, off, hour, reason, by, pm] of consults) {
    const t = await makeConsult({ patient, doctorFragment: d, offset: off, hour, reason, createdBy: by, paymentMode: pm });
    if (off === 0) todayCollected += t;
  }
  console.log(`✓ Consultations: ${consults.length} (4 expired, 5 today).`);

  // ── 2) OPD procedure bills across days + several today ───────────────────
  // [patient, offset, hour, mode, createdBy, discount, itemsShorthand]
  const procedures = [
    ["Imran Ali", -5, 12, "cash", opDesk, 0, [["Nebulisation", 2], ["X-Ray", 1]]],
    ["Rekha Sharma", -3, 13, "card", opDesk, 0, [["Physiotherapy Session", 2]]],
    ["Ganesh Patil", -2, 11, "upi", opDesk, 0, [["ECG", 1], ["CBC", 1], ["Blood Sugar", 1]]],
    ["Venkatesh Rao", -1, 14, "cash", opIp, 0, [["Plaster (POP)", 1], ["X-Ray", 1]]],
    // TODAY:
    ["Meena Kumari", 0, 10, "cash", opDesk, 0, [["X-Ray", 1], ["ECG", 1], ["CBC", 1]]],
    ["Abdul Rahman", 0, 11, "upi", opDesk, 0, [["Nebulisation", 2], ["IM Injection", 1], ["Blood Sugar", 1]]],
    ["Karthik Nair", 0, 13, "card", opIp, 0, [["Suturing", 1], ["Large Dressing", 1], ["Consumables Kit", 1]]],
    ["Aditya Verma", 0, 15, "cash", opDesk, 0, [["Catheterisation", 1], ["Urine Routine", 1], ["CBC", 1]]],
    // TODAY with a supervisor-approved discount:
    ["Farida Begum", 0, 16, "cash", opDesk, 10000, [["Physiotherapy Session", 2], ["ECG", 1]]],
  ];
  for (const [patient, off, hour, pm, by, discount, items] of procedures) {
    const t = await makeBill({
      patient, type: "procedure", createdBy: by, createdAt: dayAt(off, hour),
      paymentMode: pm, discount,
      discountApprovedBy: discount > 0 ? supervisor : null,
      items: items.map(line),
    });
    if (off === 0) todayCollected += t;
  }
  console.log(`✓ OPD procedure bills: ${procedures.length} (5 today, 1 approved-discount).`);

  // ── 3) Currently-admitted in-patients (multiple open admissions) ─────────
  // [patient, admitOffset, advance, advanceMode, roomService, expensesShorthand]
  const openAdmissions = [
    ["Deepa Nair", -1, 1000000, "upi", "Semi-Private Room (per day)", [["Nursing Charge (per day)", 1], ["IV Fluids (DNS)", 2]]],
    ["Venkatesh Rao", -3, 2000000, "card", "ICU Bed (per day)", [["Nursing Charge (per day)", 3], ["IV Antibiotic Dose", 4], ["Monitoring Charge", 3], ["Oxygen (per hour)", 6]]],
    ["Sana Sheikh", 0, 500000, "cash", "General Ward Bed (per day)", [["Nursing Charge (per day)", 1], ["Nebulisation", 2]]],
    ["Ganesh Patil", -2, 800000, "cash", "Private Room (per day)", [["Nursing Charge (per day)", 2], ["Physiotherapy Session", 1], ["ECG", 1]]],
    ["Shruti Rao", 0, 1500000, "upi", "Semi-Private Room (per day)", [["Nursing Charge (per day)", 1], ["CBC", 1]]],
  ];
  for (const [patient, off, advance, mode, roomSvc, expenses] of openAdmissions) {
    const admittedAt = dayAt(off, 8);
    const { rows } = await client.query(
      `INSERT INTO admissions
        (patient_id, admitted_at, advance_paid_paise, room_charge_paise, status,
         location_id, created_at, advance_payment_mode, room_rate_paise, room_days, created_by)
       VALUES ($1,$2,$3,0,'admitted',$4,$5,$6,$7,NULL,$8) RETURNING id`,
      [patientId[patient], admittedAt, advance, locationId, admittedAt, mode, price(roomSvc), opIp],
    );
    const admissionId = rows[0].id;
    for (const [name, qty] of expenses) {
      await client.query(
        `INSERT INTO admission_expenses (admission_id, item, quantity, total_paise)
         VALUES ($1,$2,$3,$4)`,
        [admissionId, name, qty, qty * price(name)],
      );
    }
  }
  console.log(`✓ Open admissions: ${openAdmissions.length} currently-admitted in-patients (with advances + running expenses).`);

  // ── 4) Discharged IP admissions with their bills (some today = IPD revenue) ─
  // [patient, admitOffset, dischargeOffset, roomService, roomDays, advance, mode,
  //  billMode, discount, expensesShorthand]
  const discharges = [
    ["Abdul Rahman", -6, -2, "Semi-Private Room (per day)", 4, 400000, "cash", "card", 0,
      [["Nursing Charge (per day)", 4], ["IV Antibiotic Dose", 6], ["Monitoring Charge", 2], ["ECG", 1], ["CBC", 1]]],
    ["Meena Kumari", -5, -1, "General Ward Bed (per day)", 3, 300000, "upi", "cash", 0,
      [["Nursing Charge (per day)", 3], ["Nebulisation", 4], ["X-Ray", 1], ["Blood Sugar", 2]]],
    // TODAY discharges (drive today's IPD collection):
    ["Rekha Sharma", -3, 0, "Private Room (per day)", 2, 500000, "card", "card", 0,
      [["Nursing Charge (per day)", 2], ["IV Fluids (DNS)", 3], ["ECG", 1], ["Physiotherapy Session", 1]]],
    ["Imran Ali", -4, 0, "ICU Bed (per day)", 2, 1000000, "cash", "upi", 100000,
      [["Nursing Charge (per day)", 2], ["IV Antibiotic Dose", 4], ["Monitoring Charge", 3], ["Catheterisation", 1]]],
    ["Rohit Sharma", -2, 0, "General Ward Bed (per day)", 2, 300000, "upi", "cash", 0,
      [["Nursing Charge (per day)", 2], ["Oxygen (per hour)", 4], ["Nebulisation", 3], ["X-Ray", 1]]],
  ];
  for (const [patient, aOff, dOff, roomSvc, roomDays, advance, admMode, billMode, discount, expenses] of discharges) {
    const admittedAt = dayAt(aOff, 8);
    const dischargedAt = dayAt(dOff, 12);
    const roomRate = price(roomSvc);
    const { rows } = await client.query(
      `INSERT INTO admissions
        (patient_id, admitted_at, discharged_at, advance_paid_paise, room_charge_paise, status,
         location_id, created_at, advance_payment_mode, room_rate_paise, room_days, created_by)
       VALUES ($1,$2,$3,$4,$5,'discharged',$6,$7,$8,$9,$10,$11) RETURNING id`,
      [patientId[patient], admittedAt, dischargedAt, advance, roomRate * roomDays, locationId, admittedAt, admMode, roomRate, roomDays, opIp],
    );
    const admissionId = rows[0].id;
    for (const [name, qty] of expenses) {
      await client.query(
        `INSERT INTO admission_expenses (admission_id, item, quantity, total_paise)
         VALUES ($1,$2,$3,$4)`,
        [admissionId, name, qty, qty * price(name)],
      );
    }
    const items = [
      { desc: `${roomSvc.replace(" (per day)", "")} (${roomDays} days)`, qty: roomDays, unit: roomRate },
      ...expenses.map(line),
    ];
    const t = await makeBill({
      patient, type: "ip", createdBy: opIp, createdAt: dischargedAt,
      paymentMode: billMode, admissionId, discount,
      discountApprovedBy: discount > 0 ? supervisor : null,
      items,
    });
    if (dOff === 0) todayCollected += t;
  }
  console.log(`✓ Discharged IP admissions: ${discharges.length} (3 discharged today, 1 approved-discount).`);

  // --- summary -------------------------------------------------------------
  const { rows: fin } = await client.query(
    `SELECT type, count(*)::int n, coalesce(sum(total_paise),0)::bigint gross
       FROM bills WHERE status='final' GROUP BY type ORDER BY type`,
  );
  console.log("\n--- All final bills by type (incl. earlier demo data) ---");
  for (const r of fin) console.log(`  ${r.type.padEnd(14)} ${String(r.n).padStart(3)} bills   ₹${(Number(r.gross) / 100).toLocaleString("en-IN")}`);

  const { rows: today } = await client.query(
    `SELECT coalesce(sum(total_paise),0)::bigint gross, count(*)::int n
       FROM bills
      WHERE status='final'
        AND created_at >= ('2026-07-13'::date)::timestamp AT TIME ZONE 'Asia/Kolkata'
        AND created_at <  (('2026-07-13'::date + 1))::timestamp AT TIME ZONE 'Asia/Kolkata'`,
  );
  const { rows: openN } = await client.query(
    "SELECT count(*)::int n FROM admissions WHERE status='admitted'",
  );
  console.log(`\n  Today (13 Jul) collected:  ₹${(Number(today[0].gross) / 100).toLocaleString("en-IN")} across ${today[0].n} bills`);
  console.log(`  Currently admitted:        ${openN[0].n} in-patients`);
  console.log("\n✓ Bulk demo data seeded.\n");
} catch (err) {
  console.error(`\n✗ ${err.message}\n`, err);
  process.exit(1);
} finally {
  await client.end();
}
