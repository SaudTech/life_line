// seed-demo.mjs - a rich, realistic demo dataset for local development and for
// screenshots/walkthroughs. Builds on seed-doctors + seed-services.
//
// What it creates (all money = integer paise, total = subtotal - discount):
//   - ~11 patients (varied age/gender/area; a mother + child SHARE one phone,
//     proving phone is a non-unique lookup, not an identity).
//   - OP consultations spread over the past week, each with a consultation bill
//     (valid_until = visit day + the doctor's revisit-validity days).
//   - Procedure bills with catalog line items, varied payment modes.
//   - One supervisor-APPROVED discounted bill and one VOID bill (audit trail).
//   - One discharged IP admission with itemised expenses + an IP bill, alongside
//     the already-open admission.
//
// Idempotent: patients are topped up by (name, phone); the money data (bills,
// consultations, admissions) is only seeded when the bills table is empty, so a
// re-run never duplicates receipts. Safe to run repeatedly.
//
// Usage: node --env-file=.env scripts/seed-demo.mjs

import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("\n✗ DATABASE_URL is not set.\n");
  process.exit(1);
}

const client = new pg.Client({ connectionString });

// Anchor demo data around the project's "today" so the daily report + charts
// show a believable recent trend. Kept as a fixed date (not `new Date()`) so
// re-seeds land on the same window.
const TODAY = new Date("2026-07-13T10:00:00.000Z");
function dayAt(offset, hour = 11, min = 0) {
  const d = new Date(TODAY);
  d.setUTCDate(d.getUTCDate() + offset);
  d.setUTCHours(hour, min, 0, 0);
  return d.toISOString();
}
function addDays(iso, days) {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10); // date only
}

try {
  await client.connect();

  // --- location + role user map -------------------------------------------
  const { rows: locs } = await client.query(
    "SELECT id FROM locations ORDER BY id ASC LIMIT 1",
  );
  if (locs.length === 0) {
    console.error("\n✗ No location - run the app's first-run setup first.\n");
    process.exit(1);
  }
  const locationId = locs[0].id;

  const { rows: users } = await client.query(
    "SELECT id, role FROM users WHERE active",
  );
  const byRole = (r) => {
    const u = users.find((x) => x.role === r);
    if (!u) throw new Error(`No active ${r} user - seed users first.`);
    return u.id;
  };
  const opDesk = byRole("op_desk");
  const opIp = byRole("op_ip_desk");
  const supervisor = byRole("supervisor");

  // --- doctors + services lookups -----------------------------------------
  const { rows: doctors } = await client.query(
    "SELECT id, name, fee_paise, revisit_validity_days FROM doctors ORDER BY id",
  );
  const doc = (nameFragment) => {
    const d = doctors.find((x) => x.name.includes(nameFragment));
    if (!d) throw new Error(`Doctor matching "${nameFragment}" not found.`);
    return d;
  };
  const { rows: services } = await client.query(
    "SELECT id, name, price_paise FROM services",
  );
  const svc = (name) => {
    const s = services.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!s) throw new Error(`Service "${name}" not found - run seed:services.`);
    return s;
  };

  // --- patients (idempotent top-up) ---------------------------------------
  // name, age, gender, phone, area. Fatima + Zoya deliberately share a phone.
  const PATIENTS = [
    ["Arjun Reddy", 34, "male", "9812340001", "Kukatpally"],
    ["Lakshmi Devi", 58, "female", "9812340002", "Secunderabad"],
    ["Mohammed Imran", 45, "male", "9812340003", "Charminar"],
    ["Sneha Varma", 29, "female", "9812340004", "Gachibowli"],
    ["Ramesh Babu", 62, "male", "9812340005", "Dilsukhnagar"],
    ["Fatima Begum", 40, "female", "9812340006", "Tolichowki"],
    ["Zoya Khan", 6, "female", "9812340006", "Tolichowki"],
    ["Vikram Singh", 51, "male", "9812340008", "Banjara Hills"],
    ["Ananya Iyer", 27, "female", "9812340009", "Madhapur"],
    ["Suresh Kumar", 38, "male", "9812340010", "LB Nagar"],
    ["Kavya Reddy", 3, "female", "9812340011", "Miyapur"],
  ];

  const patientId = {};
  let addedPatients = 0;
  for (const [name, age, gender, phone, area] of PATIENTS) {
    const { rows: found } = await client.query(
      "SELECT id FROM patients WHERE name = $1 AND phone = $2 LIMIT 1",
      [name, phone],
    );
    if (found.length > 0) {
      patientId[name] = found[0].id;
      continue;
    }
    const { rows: ins } = await client.query(
      `INSERT INTO patients (name, age, gender, phone, area, location_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [name, age, gender, phone, area, locationId, dayAt(-9, 9)],
    );
    patientId[name] = ins[0].id;
    addedPatients += 1;
    console.log(`  + patient ${name} (${age}${gender[0]}, ${area})`);
  }
  console.log(`\n✓ Patients: ${addedPatients} added, ${PATIENTS.length - addedPatients} already present.`);

  // --- money data: only when bills is empty (idempotency guard) ------------
  const { rows: billCount } = await client.query("SELECT count(*)::int n FROM bills");
  if (billCount[0].n > 0) {
    console.log(`\n✓ ${billCount[0].n} bill(s) already exist - skipping money-data seed (patients topped up above).\n`);
    process.exit(0);
  }

  // helper: insert a bill + its items in one transaction-ish sequence.
  async function makeBill({
    patient, type, items, discount = 0, paymentMode = "cash",
    status = "final", createdBy, createdAt, consultationId = null,
    admissionId = null, discountApprovedBy = null, voided = null,
  }) {
    const subtotal = items.reduce((s, it) => s + it.qty * it.unit, 0);
    const total = subtotal - discount;
    const { rows } = await client.query(
      `INSERT INTO bills
        (patient_id, type, subtotal_paise, discount_paise, total_paise, status,
         payment_mode, discount_approved_by, created_by, created_at,
         consultation_id, admission_id, voided_by, voided_at, void_reason, location_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING id, bill_number`,
      [
        patientId[patient], type, subtotal, discount, total, status,
        paymentMode, discountApprovedBy, createdBy, createdAt,
        consultationId, admissionId,
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
    return { billId, billNumber: rows[0].bill_number, total };
  }

  // helper: create a consultation + its consultation bill.
  async function makeConsult({ patient, doctorFragment, offset, reason, createdBy, paymentMode = "cash" }) {
    const d = doc(doctorFragment);
    const createdAt = dayAt(offset, 10, 30);
    const validUntil = addDays(createdAt, d.revisit_validity_days);
    const { rows } = await client.query(
      `INSERT INTO consultations
        (patient_id, doctor_id, fee_charged_paise, valid_until, reason, location_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [patientId[patient], d.id, d.fee_paise, validUntil, reason, locationId, createdAt],
    );
    const consultationId = rows[0].id;
    await makeBill({
      patient, type: "consultation",
      items: [{ serviceId: null, desc: `Consultation - Dr. ${d.name.replace(/^Dr\.?\s*/, "")}`, qty: 1, unit: Number(d.fee_paise) }],
      paymentMode, createdBy, createdAt, consultationId,
    });
    return consultationId;
  }

  // 1) Consultations across the week (drives OPD history + daily report).
  const consults = [
    ["Arjun Reddy", "Anita", -5, "Chest pain on exertion", opIp, "cash"],
    ["Lakshmi Devi", "Rajesh", -5, "Fever and body ache", opIp, "upi"],
    ["Mohammed Imran", "Rajesh", -4, "Persistent cough", opIp, "cash"],
    ["Kavya Reddy", "Priya", -4, "Routine child check-up", opIp, "card"],
    ["Sneha Varma", "Anita", -3, "Palpitations", opIp, "upi"],
    ["Ramesh Babu", "Rajesh", -2, "Blood pressure review", opIp, "cash"],
    ["Zoya Khan", "Priya", -2, "Cold and mild fever", opIp, "cash"],
    ["Ananya Iyer", "Rajesh", -1, "Headache and fatigue", opIp, "upi"],
    ["Vikram Singh", "Anita", 0, "Follow-up ECG review", opIp, "card"],
    ["Fatima Begum", "Rajesh", 0, "Diabetes follow-up", opIp, "cash"],
  ];
  for (const [patient, d, off, reason, by, pm] of consults) {
    await makeConsult({ patient, doctorFragment: d, offset: off, reason, createdBy: by, paymentMode: pm });
  }
  console.log(`✓ Consultations: ${consults.length} created (each with a consultation bill).`);

  // 2) Procedure bills (drives procedure history + a chunk of daily revenue).
  await makeBill({
    patient: "Mohammed Imran", type: "procedure", createdBy: opDesk, createdAt: dayAt(-4, 12),
    paymentMode: "cash",
    items: [
      { serviceId: svc("Nebulisation").id, desc: "Nebulisation", qty: 2, unit: Number(svc("Nebulisation").price_paise) },
      { serviceId: svc("X-Ray").id, desc: "X-Ray", qty: 1, unit: Number(svc("X-Ray").price_paise) },
    ],
  });
  await makeBill({
    patient: "Ramesh Babu", type: "procedure", createdBy: opDesk, createdAt: dayAt(-2, 13),
    paymentMode: "card",
    items: [
      { serviceId: svc("ECG").id, desc: "ECG", qty: 1, unit: Number(svc("ECG").price_paise) },
      { serviceId: svc("CBC").id, desc: "CBC", qty: 1, unit: Number(svc("CBC").price_paise) },
      { serviceId: svc("Blood Sugar").id, desc: "Blood Sugar", qty: 1, unit: Number(svc("Blood Sugar").price_paise) },
    ],
  });
  await makeBill({
    patient: "Sneha Varma", type: "procedure", createdBy: opDesk, createdAt: dayAt(-1, 11, 15),
    paymentMode: "upi",
    items: [
      { serviceId: svc("Suturing").id, desc: "Suturing", qty: 1, unit: Number(svc("Suturing").price_paise) },
      { serviceId: svc("Large Dressing").id, desc: "Large Dressing", qty: 1, unit: Number(svc("Large Dressing").price_paise) },
    ],
  });

  // A supervisor-APPROVED discounted procedure bill (discount => approver set).
  await makeBill({
    patient: "Suresh Kumar", type: "procedure", createdBy: opDesk, createdAt: dayAt(-1, 15),
    paymentMode: "cash", discount: 15000, discountApprovedBy: supervisor,
    items: [
      { serviceId: svc("Plaster (POP)").id, desc: "Plaster (POP)", qty: 1, unit: Number(svc("Plaster (POP)").price_paise) },
      { serviceId: svc("X-Ray").id, desc: "X-Ray", qty: 1, unit: Number(svc("X-Ray").price_paise) },
    ],
  });

  // A VOID procedure bill (correction trail: voided by a supervisor).
  await makeBill({
    patient: "Ananya Iyer", type: "procedure", createdBy: opDesk, createdAt: dayAt(-3, 16),
    paymentMode: "cash", status: "void",
    voided: { by: supervisor, at: dayAt(-3, 16, 20), reason: "Wrong patient selected - re-issued" },
    items: [
      { serviceId: svc("Wound Cleaning").id, desc: "Wound Cleaning", qty: 1, unit: Number(svc("Wound Cleaning").price_paise) },
    ],
  });
  console.log("✓ Procedure bills: 5 created (incl. 1 approved-discount, 1 void).");

  // 3) A discharged IP admission with itemised expenses + an IP bill.
  const roomRate = Number(svc("Semi-Private Room (per day)").price_paise);
  const roomDays = 3;
  const admittedAt = dayAt(-4, 8);
  const dischargedAt = dayAt(-1, 12);
  const { rows: adm } = await client.query(
    `INSERT INTO admissions
      (patient_id, admitted_at, discharged_at, advance_paid_paise, room_charge_paise,
       status, location_id, created_at, advance_payment_mode, room_rate_paise, room_days, created_by)
     VALUES ($1,$2,$3,$4,$5,'discharged',$6,$7,'cash',$8,$9,$10) RETURNING id`,
    [patientId["Vikram Singh"], admittedAt, dischargedAt, 500000, roomRate * roomDays, locationId, admittedAt, roomRate, roomDays, opIp],
  );
  const admissionId = adm[0].id;
  const ipExpenses = [
    ["Nursing Charge (per day)", 3],
    ["IV Antibiotic Dose", 4],
    ["Monitoring Charge", 2],
    ["ECG", 1],
    ["CBC", 1],
  ];
  for (const [name, qty] of ipExpenses) {
    const s = svc(name);
    await client.query(
      `INSERT INTO admission_expenses (admission_id, item, quantity, total_paise)
       VALUES ($1,$2,$3,$4)`,
      [admissionId, name, qty, qty * Number(s.price_paise)],
    );
  }
  // IP discharge bill: room charge + all expenses as line items.
  const ipItems = [
    { serviceId: null, desc: `Semi-Private Room (${roomDays} days)`, qty: roomDays, unit: roomRate },
    ...ipExpenses.map(([name, qty]) => ({ serviceId: svc(name).id, desc: name, qty, unit: Number(svc(name).price_paise) })),
  ];
  await makeBill({
    patient: "Vikram Singh", type: "ip", createdBy: opIp, createdAt: dischargedAt,
    paymentMode: "card", admissionId,
    items: ipItems,
  });
  console.log("✓ IP: 1 discharged admission with 5 expense lines + IP discharge bill.");

  const { rows: fin } = await client.query(
    "SELECT type, count(*)::int n, coalesce(sum(total_paise),0)::bigint gross FROM bills WHERE status='final' GROUP BY type ORDER BY type",
  );
  console.log("\n--- Final bills by type ---");
  for (const r of fin) console.log(`  ${r.type.padEnd(14)} ${r.n} bills   ₹${(Number(r.gross) / 100).toLocaleString("en-IN")}`);
  console.log("\n✓ Demo data seeded.\n");
} catch (err) {
  console.error(`\n✗ ${err.message}\n`, err);
  process.exit(1);
} finally {
  await client.end();
}
