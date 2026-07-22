// seed-today.mjs - a realistic FULL BUSINESS DAY for the current clinic day, so the
// dashboard, daily report, consultation/procedure history, and IP screens all show
// real-looking activity instead of an empty counter.
//
// Simulates both desk staff working a full day:
//   - ~80 OPD consultations EACH (160 total) across the 3 real doctors, spread over
//     business hours, mostly new patients with a handful of natural repeat visits.
//   - ~28 procedure bills ("other things": X-Ray, ECG, dressings, nebulisation, ...).
//   - IP: 3 admissions admitted earlier and discharged TODAY (full discharge bill,
//     with balance_due_paise/refund_paise settled against the advance - see
//     migration 0018 and lib/billing/discharge.ts) + 2 still-admitted in-patients
//     (advance taken, expenses running, no bill yet).
//   - 1 voided procedure bill, for a believable correction trail.
//
// Idempotent: keyed on a sentinel patient (phone 9000000001). If it already exists,
// the whole money seed is skipped so re-running never duplicates today's receipts.
//
// Usage: node --env-file=.env scripts/seed-today.mjs

import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("\n✗ DATABASE_URL is not set.\n");
  process.exit(1);
}

const client = new pg.Client({ connectionString });

// The clinic's "today" (Asia/Kolkata calendar day) this data is anchored to.
const CLINIC_DAY = "2026-07-22";

// Convert an IST wall-clock hour/minute on CLINIC_DAY to a UTC instant (IST = UTC+5:30).
function istIso(hour, min = 0) {
  const [y, m, d] = CLINIC_DAY.split("-").map(Number);
  const totalMin = hour * 60 + min - 330;
  return new Date(Date.UTC(y, m - 1, d, 0, totalMin)).toISOString();
}
function addDaysIso(dateOnly, days) {
  const [y, m, d] = dateOnly.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function randInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}
function weighted(pairs) {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [v, w] of pairs) {
    r -= w;
    if (r <= 0) return v;
  }
  return pairs[pairs.length - 1][0];
}

const MALE_FIRST = [
  "Arjun", "Vikram", "Suresh", "Ramesh", "Karthik", "Imran", "Abdul", "Rahul",
  "Anil", "Sanjay", "Naveen", "Praveen", "Rajesh", "Farooq", "Ashok", "Vinod",
  "Ravi", "Krishna", "Manoj", "Srinivas", "Gopal", "Shabbir", "Younus", "Harish",
  "Dinesh", "Ayaan", "Kabir", "Ibrahim", "Yusuf", "Nikhil",
];
const FEMALE_FIRST = [
  "Lakshmi", "Sneha", "Fatima", "Ananya", "Kavya", "Meena", "Divya", "Priyanka",
  "Rekha", "Sana", "Farida", "Shruti", "Deepa", "Anjali", "Pooja", "Nasreen",
  "Swathi", "Radha", "Zainab", "Padma", "Asha", "Bhavana", "Ruksana", "Geetha",
  "Sindhu", "Ayesha", "Manasa", "Kiranmayi", "Tabassum", "Vani",
];
const LAST = [
  "Reddy", "Rao", "Sharma", "Khan", "Begum", "Varma", "Nair", "Kumar", "Iyer",
  "Menon", "Naidu", "Goud", "Patel", "Shaik", "Devi", "Prasad", "Chandra",
  "Gupta", "Verma", "Yadav", "Reddy Gari", "Achari", "Singh", "Rathod",
];
const AREAS = [
  "Kukatpally", "Secunderabad", "Charminar", "Gachibowli", "Dilsukhnagar",
  "Tolichowki", "Banjara Hills", "Madhapur", "LB Nagar", "Miyapur", "Ameerpet",
  "Kondapur", "Mehdipatnam", "KPHB", "Uppal", "Malakpet", "Santoshnagar",
  "Manikonda", "Begumpet", "Nampally", "Alwal", "Yakutpura", "Kompally", "Nizampet",
];
const REASONS = [
  "Fever and body ache", "Persistent cough", "Chest pain on exertion",
  "Headache and fatigue", "Blood pressure review", "Diabetes follow-up",
  "Stomach ache", "Cold and mild fever", "Joint pain", "Skin rash",
  "Routine child check-up", "Ante-natal check-up", "Palpitations",
  "Follow-up ECG review", "Acidity", "Knee pain", "Back pain",
  "Throat infection", "Vomiting and loose motions", "Dizziness",
  "Allergy symptoms", "Weakness", "Migraine", "Minor injury review",
];
const PROCEDURE_SERVICES = [
  "Nebulisation", "X-Ray", "ECG", "CBC", "Blood Sugar", "Suturing",
  "Large Dressing", "Small Dressing", "Plaster (POP)", "Physiotherapy Session",
  "IM Injection", "Catheterisation", "Urine Routine", "Consumables Kit",
  "Wound Cleaning", "Dressing Tray", "Injection", "IV", "Insulin Dose",
];
const IP_EXPENSE_SERVICES = [
  "Nursing Charge (per day)", "IV Antibiotic Dose", "Monitoring Charge",
  "ECG", "CBC", "Blood Sugar", "Nebulisation", "Oxygen (per hour)",
  "IV Fluids (DNS)", "Catheterisation", "X-Ray",
];
const ROOM_SERVICES = [
  "General Ward Bed (per day)", "Semi-Private Room (per day)",
  "Private Room (per day)", "ICU Bed (per day)",
];
const PAYMENT_MODES = [
  ["cash", 45], ["upi", 25], ["card", 25], ["other", 5],
];

try {
  await client.connect();

  const { rows: locs } = await client.query("SELECT id FROM locations ORDER BY id ASC LIMIT 1");
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
  const staffName = (id) => users.find((u) => u.id === id).name;

  const { rows: doctorsRaw } = await client.query(
    "SELECT id, name, fee_paise, revisit_validity_days FROM doctors WHERE active ORDER BY id",
  );
  // Exclude stray/test rows (e.g. a bare "Dr List" entry with no real name).
  const doctors = doctorsRaw.filter((d) => /^Dr\.?\s+\S/.test(d.name));
  if (doctors.length === 0) throw new Error("No usable doctors found - run seed:doctors.");

  const { rows: services } = await client.query("SELECT id, name, price_paise FROM services WHERE active");
  const svc = (name) => {
    const s = services.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!s) throw new Error(`Service "${name}" not found - run seed:services.`);
    return s;
  };
  const price = (name) => Number(svc(name).price_paise);

  // --- idempotency guard ----------------------------------------------------
  const SENTINEL_PHONE = "9000000001";
  const { rows: sentinel } = await client.query(
    "SELECT id FROM patients WHERE phone = $1 AND name = $2 LIMIT 1",
    [SENTINEL_PHONE, "Seed Today Sentinel"],
  );
  if (sentinel.length > 0) {
    console.log(`\n✓ Today's data (${CLINIC_DAY}) already seeded - nothing to add.\n`);
    process.exit(0);
  }
  await client.query(
    `INSERT INTO patients (name, age, gender, phone, area, location_id, created_at)
     VALUES ($1,1,'other',$2,'Seed',$3,$4)`,
    ["Seed Today Sentinel", SENTINEL_PHONE, locationId, istIso(8, 0)],
  );

  // --- patient pool (bulk-registered walk-ins for today) --------------------
  const POOL_SIZE = 150;
  const pool = [];
  for (let i = 0; i < POOL_SIZE; i++) {
    const gender = Math.random() < 0.5 ? "male" : "female";
    const first = pick(gender === "male" ? MALE_FIRST : FEMALE_FIRST);
    const last = pick(LAST);
    const age = randInt(1, 85);
    const phone = `900010${String(1000 + i).slice(-4)}`;
    const area = pick(AREAS);
    const registeredAt = istIso(randInt(8, 19), randInt(0, 59));
    const { rows } = await client.query(
      `INSERT INTO patients (name, age, gender, phone, area, location_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [`${first} ${last}`, age, gender, phone, area, locationId, registeredAt],
    );
    pool.push({ id: rows[0].id, name: `${first} ${last}` });
  }
  console.log(`✓ Patients: ${POOL_SIZE} registered for today's walk-ins.`);

  // --- helpers ---------------------------------------------------------------
  async function makeBill({
    patientId, type, items, discount = 0, paymentMode = "cash",
    status = "final", createdBy, createdAt, admissionId = null,
    consultationId = null, discountApprovedBy = null, voided = null,
    balanceDuePaise = 0, refundPaise = 0,
  }) {
    const subtotal = items.reduce((s, it) => s + it.qty * it.unit, 0);
    const total = subtotal - discount;
    const { rows } = await client.query(
      `INSERT INTO bills
        (patient_id, type, subtotal_paise, discount_paise, total_paise, status,
         payment_mode, discount_approved_by, created_by, created_at,
         admission_id, consultation_id, voided_by, voided_at, void_reason, location_id,
         balance_due_paise, refund_paise)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING id, bill_number`,
      [
        patientId, type, subtotal, discount, total, status,
        paymentMode, discountApprovedBy, createdBy, createdAt, admissionId, consultationId,
        voided?.by ?? null, voided?.at ?? null, voided?.reason ?? null, locationId,
        balanceDuePaise, refundPaise,
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
    return { billId, total };
  }

  function maybeDiscount() {
    if (Math.random() > 0.06) return { discount: 0, approvedBy: null };
    return { discount: null, approvedBy: supervisor }; // resolved against subtotal by caller
  }

  async function makeConsult({ patientId, doctor, hour, min, reason, createdBy }) {
    const createdAt = istIso(hour, min);
    const validUntil = addDaysIso(CLINIC_DAY, doctor.revisit_validity_days);
    const { rows } = await client.query(
      `INSERT INTO consultations
        (patient_id, doctor_id, fee_charged_paise, valid_until, reason, location_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [patientId, doctor.id, doctor.fee_paise, validUntil, reason, locationId, createdAt],
    );
    const subtotal = Number(doctor.fee_paise);
    const d = maybeDiscount();
    const discount = d.discount === null ? Math.round(subtotal * (randInt(10, 20) / 100)) : 0;
    return makeBill({
      patientId, type: "consultation", consultationId: rows[0].id,
      items: [{ desc: `Consultation - ${doctor.name}`, qty: 1, unit: subtotal }],
      paymentMode: weighted(PAYMENT_MODES), createdBy, createdAt,
      discount, discountApprovedBy: discount > 0 ? d.approvedBy : null,
    });
  }

  function line(name, qty) {
    return { serviceId: svc(name).id, desc: name, qty, unit: price(name) };
  }
  function randomItems(pool_, minN, maxN, maxQty = 2) {
    const n = randInt(minN, maxN);
    const chosen = new Set();
    while (chosen.size < n) chosen.add(pick(pool_));
    return [...chosen].map((name) => line(name, randInt(1, maxQty)));
  }

  // ── 1) Consultations - ~80 per desk staff, across the day ─────────────────
  const STAFF_SHIFTS = [
    { id: opDesk, label: "op_desk", startHour: 9, endHour: 18, count: 80 },
    { id: opIp, label: "op_ip_desk", startHour: 9, endHour: 19, count: 80 },
  ];
  let todayCollected = 0;
  let consultCount = 0;
  for (const shift of STAFF_SHIFTS) {
    for (let i = 0; i < shift.count; i++) {
      const patient = pick(pool);
      const doctor = pick(doctors);
      const hour = randInt(shift.startHour, shift.endHour - 1);
      const min = randInt(0, 59);
      const { total } = await makeConsult({
        patientId: patient.id, doctor, hour, min,
        reason: pick(REASONS), createdBy: shift.id,
      });
      todayCollected += total;
      consultCount += 1;
    }
    console.log(`✓ Consultations by ${staffName(shift.id)}: ${shift.count}.`);
  }
  console.log(`✓ Consultations total: ${consultCount}.`);

  // ── 2) Procedure bills - "other things": X-Ray, dressings, nebulisation, etc ─
  const PROCEDURE_STAFF = [
    { id: opDesk, count: 14 },
    { id: opIp, count: 14 },
  ];
  let procCount = 0;
  for (const s of PROCEDURE_STAFF) {
    for (let i = 0; i < s.count; i++) {
      const patient = pick(pool);
      const hour = randInt(9, 19);
      const min = randInt(0, 59);
      const createdAt = istIso(hour, min);
      const items = randomItems(PROCEDURE_SERVICES, 1, 3);
      const subtotal = items.reduce((sum, it) => sum + it.qty * it.unit, 0);
      const d = maybeDiscount();
      const discount = d.discount === null ? Math.round(subtotal * (randInt(10, 20) / 100)) : 0;
      const { total } = await makeBill({
        patientId: patient.id, type: "procedure", items,
        paymentMode: weighted(PAYMENT_MODES), createdBy: s.id, createdAt,
        discount, discountApprovedBy: discount > 0 ? d.approvedBy : null,
      });
      todayCollected += total;
      procCount += 1;
    }
  }
  console.log(`✓ Procedure bills: ${procCount}.`);

  // A voided procedure bill (correction trail: wrong patient, re-issued).
  {
    const patient = pick(pool);
    const items = randomItems(PROCEDURE_SERVICES, 1, 2);
    await makeBill({
      patientId: patient.id, type: "procedure", items,
      paymentMode: "cash", createdBy: opDesk, createdAt: istIso(11, 40), status: "void",
      voided: { by: supervisor, at: istIso(11, 45), reason: "Wrong patient selected - re-issued" },
    });
    console.log("✓ Void bill: 1 (correction trail).");
  }

  // ── 3) In-patients: 3 discharged today, 2 still admitted ───────────────────
  const discharges = [
    { admitOffsetDays: -2, roomSvc: "Semi-Private Room (per day)", roomDays: 3, advance: 800000, advMode: "upi", billMode: "card" },
    { admitOffsetDays: -1, roomSvc: "General Ward Bed (per day)", roomDays: 2, advance: 400000, advMode: "cash", billMode: "cash" },
    { admitOffsetDays: 0, roomSvc: "Private Room (per day)", roomDays: 1, advance: 1500000, advMode: "card", billMode: "upi" },
  ];
  for (const dRow of discharges) {
    const patient = pick(pool);
    const admittedAt = dRow.admitOffsetDays === 0
      ? istIso(8, 0)
      : new Date(new Date(istIso(8, 0)).getTime() + dRow.admitOffsetDays * 86400000).toISOString();
    const dischargedAt = istIso(randInt(12, 18), randInt(0, 59));
    const roomRate = price(dRow.roomSvc);
    const expenses = randomItems(IP_EXPENSE_SERVICES, 3, 5, 3);
    const { rows } = await client.query(
      `INSERT INTO admissions
        (patient_id, admitted_at, discharged_at, advance_paid_paise, room_charge_paise,
         status, location_id, created_at, advance_payment_mode, room_rate_paise, room_days, created_by)
       VALUES ($1,$2,$3,$4,$5,'discharged',$6,$7,$8,$9,$10,$11) RETURNING id`,
      [patient.id, admittedAt, dischargedAt, dRow.advance, roomRate * dRow.roomDays, locationId,
        admittedAt, dRow.advMode, roomRate, dRow.roomDays, opIp],
    );
    const admissionId = rows[0].id;
    for (const it of expenses) {
      await client.query(
        `INSERT INTO admission_expenses (admission_id, item, quantity, total_paise)
         VALUES ($1,$2,$3,$4)`,
        [admissionId, it.desc, it.qty, it.qty * it.unit],
      );
    }
    // calculateDischargeBalance (lib/billing/discharge.ts): total = (room + expenses)
    // - discount; balanceDue/refund settle that total against the advance.
    const roomItem = { serviceId: null, desc: `${dRow.roomSvc.replace(" (per day)", "")} (${dRow.roomDays} days)`, qty: dRow.roomDays, unit: roomRate };
    const items = [roomItem, ...expenses];
    const subtotal = items.reduce((sum, it) => sum + it.qty * it.unit, 0);
    const total = subtotal; // no discount on these discharges
    const balanceDuePaise = Math.max(0, total - dRow.advance);
    const refundPaise = Math.max(0, dRow.advance - total);
    await makeBill({
      patientId: patient.id, type: "ip", createdBy: opIp, createdAt: dischargedAt,
      paymentMode: dRow.billMode, admissionId, items,
      balanceDuePaise, refundPaise,
    });
    todayCollected += balanceDuePaise; // only the balance actually changes hands at discharge
  }
  console.log(`✓ Discharged IP admissions: ${discharges.length} (today).`);

  const openAdmissions = [
    { roomSvc: "ICU Bed (per day)", advance: 2000000, advMode: "card" },
    { roomSvc: "Semi-Private Room (per day)", advance: 600000, advMode: "cash" },
  ];
  for (const oRow of openAdmissions) {
    const patient = pick(pool);
    const admittedAt = istIso(randInt(8, 12), randInt(0, 59));
    const { rows } = await client.query(
      `INSERT INTO admissions
        (patient_id, admitted_at, advance_paid_paise, room_charge_paise, status,
         location_id, created_at, advance_payment_mode, room_rate_paise, room_days, created_by)
       VALUES ($1,$2,$3,0,'admitted',$4,$5,$6,$7,NULL,$8) RETURNING id`,
      [patient.id, admittedAt, oRow.advance, locationId, admittedAt, oRow.advMode, price(oRow.roomSvc), opIp],
    );
    const admissionId = rows[0].id;
    const expenses = randomItems(IP_EXPENSE_SERVICES, 2, 4, 2);
    for (const it of expenses) {
      await client.query(
        `INSERT INTO admission_expenses (admission_id, item, quantity, total_paise)
         VALUES ($1,$2,$3,$4)`,
        [admissionId, it.desc, it.qty, it.qty * it.unit],
      );
    }
    todayCollected += oRow.advance; // advance collected at admission counts as money in today
  }
  console.log(`✓ Currently-admitted in-patients: ${openAdmissions.length} (advance taken today).`);

  // --- summary ----------------------------------------------------------------
  const { rows: fin } = await client.query(
    `SELECT type, count(*)::int n, coalesce(sum(total_paise),0)::bigint gross
       FROM bills WHERE status='final' AND created_at::date = ($1::date)
       GROUP BY type ORDER BY type`,
    [CLINIC_DAY],
  );
  console.log(`\n--- ${CLINIC_DAY}: final bills by type ---`);
  for (const r of fin) console.log(`  ${r.type.padEnd(14)} ${String(r.n).padStart(3)} bills   ₹${(Number(r.gross) / 100).toLocaleString("en-IN")}`);
  console.log(`\n  Estimated cash-drawer impact today: ₹${(todayCollected / 100).toLocaleString("en-IN")}`);
  console.log("\n✓ Today's business day seeded.\n");
} catch (err) {
  console.error(`\n✗ ${err.message}\n`, err);
  process.exit(1);
} finally {
  await client.end();
}
