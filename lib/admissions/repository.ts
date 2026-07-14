import { pool } from "@/lib/db";
import type { PaymentMode } from "@/lib/consultations/repository";

// Data access for the in-patient admit → discharge flow (plan §5/§6). Thin:
// queries only. The money decisions are the pure rule calculateDischargeBalance
// (billing/discharge.ts), invoked by the action; this layer reads the admission +
// its expenses and writes the admission, the expenses, and the discharge bill.
// Mirrors lib/procedures/repository.ts. All money stays as paise strings (pg
// returns BIGINT as text); the UI formats with formatPaise, never a float here.

// A row in the admissions list: the admission plus its patient, the advance, and
// a live running total (room + Σ expenses) so the desk always sees the current
// bill. admitted_label / discharged_label are pre-formatted in the clinic tz so
// the client never touches a raw timestamp.
export interface AdmissionListRow {
  id: string;
  status: "admitted" | "discharged";
  patient_id: string;
  patient_name: string;
  patient_code: string;
  phone: string | null;
  admitted_label: string;
  discharged_label: string | null;
  advance_paid_paise: string;
  room_charge_paise: string;
  expenses_total_paise: string; // Σ expense totals
  running_total_paise: string; // room + Σ expenses
  expense_count: number;
  // The discharge bill, when discharged (null while still admitted).
  bill_id: string | null;
  bill_number: string | null;
  bill_total_paise: string | null;
}

// The admitted OR discharged list, newest activity first. Search-first friendly
// but the in-patient census is small, so a capped full list is fine here.
export async function listAdmissions(
  status: "admitted" | "discharged",
  limit = 200,
): Promise<AdmissionListRow[]> {
  const orderCol = status === "admitted" ? "a.admitted_at" : "a.discharged_at";
  const { rows } = await pool.query<AdmissionListRow>(
    `SELECT a.id::text,
            a.status,
            p.id::text                                       AS patient_id,
            p.name                                           AS patient_name,
            p.patient_code,
            p.phone,
            to_char(a.admitted_at   AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM') AS admitted_label,
            to_char(a.discharged_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM') AS discharged_label,
            a.advance_paid_paise::text,
            a.room_charge_paise::text,
            COALESCE(e.total, 0)::text                        AS expenses_total_paise,
            (a.room_charge_paise + COALESCE(e.total, 0))::text AS running_total_paise,
            COALESCE(e.n, 0)::int                             AS expense_count,
            b.id::text                                        AS bill_id,
            b.bill_number::text                               AS bill_number,
            b.total_paise::text                               AS bill_total_paise
       FROM admissions a
       JOIN patients p ON p.id = a.patient_id
       LEFT JOIN (
         SELECT admission_id, sum(total_paise) AS total, count(*) AS n
           FROM admission_expenses GROUP BY admission_id
       ) e ON e.admission_id = a.id
       LEFT JOIN bills b ON b.admission_id = a.id AND b.type = 'ip'
      WHERE a.status = $1
      ORDER BY ${orderCol} DESC, a.id DESC
      LIMIT $2`,
    [status, limit],
  );
  return rows;
}

export interface AdmissionExpenseRow {
  id: string;
  item: string;
  quantity: number;
  total_paise: string;
}

// The full detail for one admission: the admission + patient + its itemised
// expenses. Null if the admission doesn't exist.
export interface AdmissionDetail {
  id: string;
  status: "admitted" | "discharged";
  patient_id: string;
  patient_name: string;
  patient_code: string;
  phone: string | null;
  age: number | null;
  gender: string | null;
  admitted_label: string;
  discharged_label: string | null;
  advance_paid_paise: string;
  advance_payment_mode: string | null;
  room_charge_paise: string;
  room_rate_paise: string | null;
  room_days: number | null;
  // Suggested day count from the actual stay length (admit → now/discharge),
  // clamped to at least 1 - pre-fills the discharge room-days field for the
  // common "how many days was the patient in?" case (the desk can still adjust).
  stay_days: number;
  expenses: AdmissionExpenseRow[];
  // The discharge bill, when discharged.
  bill_id: string | null;
  bill_number: string | null;
  bill_total_paise: string | null;
  bill_subtotal_paise: string | null;
  bill_discount_paise: string | null;
  bill_payment_mode: string | null;
  bill_status: string | null;
}

export async function getAdmissionDetail(id: string): Promise<AdmissionDetail | null> {
  const { rows } = await pool.query<Omit<AdmissionDetail, "expenses">>(
    `SELECT a.id::text,
            a.status,
            p.id::text        AS patient_id,
            p.name            AS patient_name,
            p.patient_code,
            p.phone,
            p.age,
            p.gender,
            to_char(a.admitted_at   AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM') AS admitted_label,
            to_char(a.discharged_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM') AS discharged_label,
            a.advance_paid_paise::text,
            a.advance_payment_mode,
            a.room_charge_paise::text,
            a.room_rate_paise::text,
            a.room_days,
            GREATEST(1, CEIL(EXTRACT(EPOCH FROM (COALESCE(a.discharged_at, now()) - a.admitted_at)) / 86400))::int AS stay_days,
            b.id::text            AS bill_id,
            b.bill_number::text   AS bill_number,
            b.total_paise::text   AS bill_total_paise,
            b.subtotal_paise::text AS bill_subtotal_paise,
            b.discount_paise::text AS bill_discount_paise,
            b.payment_mode        AS bill_payment_mode,
            b.status              AS bill_status
       FROM admissions a
       JOIN patients p ON p.id = a.patient_id
       LEFT JOIN bills b ON b.admission_id = a.id AND b.type = 'ip'
      WHERE a.id = $1`,
    [id],
  );
  const core = rows[0];
  if (!core) return null;
  const { rows: expenses } = await pool.query<AdmissionExpenseRow>(
    `SELECT id::text, item, quantity, total_paise::text
       FROM admission_expenses
      WHERE admission_id = $1
      ORDER BY id ASC`,
    [id],
  );
  return { ...core, expenses };
}

// The minimal shape the discharge math needs: status (to guard), advance, room,
// and the expense totals. Null if the admission doesn't exist.
export interface AdmissionForDischarge {
  id: string;
  status: "admitted" | "discharged";
  patientId: string;
  advancePaise: string;
  roomChargePaise: string;
  roomRatePaise: string | null;
  roomDays: number | null;
  expenses: { id: string; item: string; quantity: number; totalPaise: string }[];
}

export async function getAdmissionForDischarge(
  id: string,
): Promise<AdmissionForDischarge | null> {
  const { rows } = await pool.query<{
    id: string;
    status: "admitted" | "discharged";
    patient_id: string;
    advance_paid_paise: string;
    room_charge_paise: string;
    room_rate_paise: string | null;
    room_days: number | null;
  }>(
    `SELECT id::text, status, patient_id::text, advance_paid_paise::text,
            room_charge_paise::text, room_rate_paise::text, room_days
       FROM admissions WHERE id = $1`,
    [id],
  );
  const core = rows[0];
  if (!core) return null;
  const { rows: expenses } = await pool.query<{
    id: string;
    item: string;
    quantity: number;
    total_paise: string;
  }>(
    `SELECT id::text, item, quantity, total_paise::text
       FROM admission_expenses WHERE admission_id = $1 ORDER BY id ASC`,
    [id],
  );
  return {
    id: core.id,
    status: core.status,
    patientId: core.patient_id,
    advancePaise: core.advance_paid_paise,
    roomChargePaise: core.room_charge_paise,
    roomRatePaise: core.room_rate_paise,
    roomDays: core.room_days,
    expenses: expenses.map((e) => ({
      id: e.id,
      item: e.item,
      quantity: e.quantity,
      totalPaise: e.total_paise,
    })),
  };
}

export interface CreateAdmissionInput {
  patientId: string;
  advancePaise: number;
  advancePaymentMode: PaymentMode;
  roomChargePaise: number;
  roomRatePaise: number | null;
  roomDays: number | null;
  createdBy: string; // who took the admission + its advance (attribution, plan §2)
  locationId: string;
}

// Insert one admission row (status 'admitted'). Wrapped in a transaction per
// DEVELOPMENT_RULES §4 (admission + advance save all-or-nothing) even though it's
// a single INSERT today - so adding a second write later can't accidentally leave
// a half-saved admission.
export async function createAdmission(
  input: CreateAdmissionInput,
): Promise<{ admissionId: string }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO admissions
         (patient_id, advance_paid_paise, advance_payment_mode, room_charge_paise,
          room_rate_paise, room_days, status, created_by, location_id)
       VALUES ($1, $2, $3, $4, $5, $6, 'admitted', $7, $8)
       RETURNING id`,
      [
        input.patientId,
        input.advancePaise,
        input.advancePaymentMode,
        input.roomChargePaise,
        input.roomRatePaise,
        input.roomDays,
        input.createdBy,
        input.locationId,
      ],
    );
    await client.query("COMMIT");
    return { admissionId: rows[0].id };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Add one expense line to an ADMITTED admission. Guarded (status = 'admitted') so
// nothing can be billed onto an already-discharged stay. Returns the new row's id,
// or null if the admission isn't admitted (or doesn't exist).
export async function addAdmissionExpense(input: {
  admissionId: string;
  item: string;
  quantity: number;
  totalPaise: number;
}): Promise<{ id: string } | null> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO admission_expenses (admission_id, item, quantity, total_paise)
       SELECT $1, $2, $3, $4
        WHERE EXISTS (SELECT 1 FROM admissions WHERE id = $1 AND status = 'admitted')
     RETURNING id`,
    [input.admissionId, input.item, input.quantity, input.totalPaise],
  );
  return rows[0] ?? null;
}

// Remove an expense line from an ADMITTED admission. Guarded on both the expense
// belonging to this admission AND the admission still being admitted, so a
// discharged stay's itemisation can never change after the bill exists. Returns
// true when a row was actually removed.
export async function removeAdmissionExpense(input: {
  admissionId: string;
  expenseId: string;
}): Promise<boolean> {
  const res = await pool.query(
    `DELETE FROM admission_expenses
      WHERE id = $1
        AND admission_id = $2
        AND EXISTS (SELECT 1 FROM admissions WHERE id = $2 AND status = 'admitted')`,
    [input.expenseId, input.admissionId],
  );
  return res.rowCount === 1;
}

// Change the quantity (and its server-recomputed total) of an expense line on an
// ADMITTED admission. Guarded on both the expense belonging to this admission AND
// the admission still being admitted, so a discharged stay's itemisation can never
// change after the bill exists. Returns true when a row was actually updated.
export async function updateAdmissionExpenseQuantity(input: {
  admissionId: string;
  expenseId: string;
  quantity: number;
  totalPaise: number;
}): Promise<boolean> {
  const res = await pool.query(
    `UPDATE admission_expenses
        SET quantity = $3, total_paise = $4
      WHERE id = $1
        AND admission_id = $2
        AND EXISTS (SELECT 1 FROM admissions WHERE id = $2 AND status = 'admitted')`,
    [input.expenseId, input.admissionId, input.quantity, input.totalPaise],
  );
  return res.rowCount === 1;
}

export interface DischargeBillLineInput {
  description: string;
  quantity: number;
  unitPricePaise: number;
  lineTotalPaise: number;
}

export interface DischargeInput {
  admissionId: string;
  patientId: string;
  roomChargePaise: number;
  roomRatePaise: number | null;
  roomDays: number | null;
  lines: DischargeBillLineInput[];
  subtotalPaise: number;
  discountPaise: number;
  totalPaise: number;
  paymentMode: PaymentMode;
  discountApprovedBy: string | null;
  createdBy: string;
  locationId: string;
}

// Discharge an admitted patient: write the final `ip` bill + its items AND flip
// the admission to discharged, all in ONE transaction (plan §6a). The admission
// UPDATE is GUARDED (status = 'admitted') so a double-discharge or a stale tab
// writes NOTHING and returns null - never a second bill. The room charge on the
// admission is also set here (the desk may confirm/adjust it at discharge). Mirrors
// createProcedureBill's BEGIN/INSERT bill + items/COMMIT template.
export async function dischargeWithBill(
  input: DischargeInput,
): Promise<{ billId: string; billNumber: string } | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Guard first: only an admitted stay can be discharged. Doing the UPDATE up
    // front (and bailing on 0 rows) means a double-discharge never even inserts a
    // bill.
    const upd = await client.query(
      `UPDATE admissions
          SET status = 'discharged', discharged_at = now(),
              room_charge_paise = $2, room_rate_paise = $3, room_days = $4
        WHERE id = $1 AND status = 'admitted'`,
      [input.admissionId, input.roomChargePaise, input.roomRatePaise, input.roomDays],
    );
    if (upd.rowCount === 0) {
      await client.query("ROLLBACK");
      return null;
    }

    const bill = await client.query<{ id: string; bill_number: string }>(
      `INSERT INTO bills
         (patient_id, type, admission_id, subtotal_paise, discount_paise, total_paise,
          status, payment_mode, discount_approved_by, created_by, location_id)
       VALUES ($1, 'ip', $2, $3, $4, $5, 'final', $6, $7, $8, $9)
       RETURNING id, bill_number`,
      [
        input.patientId,
        input.admissionId,
        input.subtotalPaise,
        input.discountPaise,
        input.totalPaise,
        input.paymentMode,
        input.discountApprovedBy,
        input.createdBy,
        input.locationId,
      ],
    );
    const billId = bill.rows[0].id;

    for (const line of input.lines) {
      await client.query(
        `INSERT INTO bill_items
           (bill_id, service_id, description, quantity, unit_price_paise, line_total_paise)
         VALUES ($1, NULL, $2, $3, $4, $5)`,
        [billId, line.description, line.quantity, line.unitPricePaise, line.lineTotalPaise],
      );
    }

    await client.query("COMMIT");
    return { billId, billNumber: bill.rows[0].bill_number };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
