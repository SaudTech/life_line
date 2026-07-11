import { pool } from "@/lib/db";
import type { IsoDay } from "./rules";

// Data access for consultations + their visits (PROJECT_OVERVIEW §Consultation).
// Thin: queries only - the free-revisit decision is the pure rule in ./rules.ts,
// invoked by the action; this layer just reads the candidate consultation and
// writes the consultation/visit rows.
//
// valid_until is a DATE (no time-of-day). We always read it as a 'YYYY-MM-DD'
// string via to_char so it never round-trips through a JS Date and shifts a day
// across time zones - the same ISO-day discipline the rules use.

export interface ConsultationRow {
  id: string;
  patient_id: string;
  doctor_id: string;
  fee_charged_paise: string; // BIGINT as string; format with formatPaise
  valid_until: IsoDay;
  created_at: Date;
}

// The latest consultation for this patient + doctor (by the farthest valid_until),
// regardless of whether it is still valid. The action feeds it to the pure rule
// isRevisitFree, which decides free-vs-paid - the validity check lives THERE, the
// one source of truth, not in this query. NULL when the patient has never seen
// this doctor. Doctor identity is scoped here because a different doctor is always
// a new consultation.
export async function findLatestConsultationForDoctor(
  patientId: string,
  doctorId: string,
): Promise<{ id: string; doctor_id: string; valid_until: IsoDay } | null> {
  const { rows } = await pool.query<{
    id: string;
    doctor_id: string;
    valid_until: IsoDay;
  }>(
    `SELECT id, doctor_id, to_char(valid_until, 'YYYY-MM-DD') AS valid_until
       FROM consultations
      WHERE patient_id = $1
        AND doctor_id = $2
      ORDER BY valid_until DESC, id DESC
      LIMIT 1`,
    [patientId, doctorId],
  );
  return rows[0] ?? null;
}

export type PaymentMode = "cash" | "card" | "upi" | "other";

export interface CreateConsultationInput {
  patientId: string;
  doctorId: string;
  feeChargedPaise: number; // the doctor's base fee, copied by the action
  validUntil: IsoDay; // computed by the pure rule
  reason: string | null;
  locationId: string;
  // Bill (the money record for this consultation) - amounts are integer paise,
  // computed by the pure billing rules in the action, never trusted from the client.
  subtotalPaise: number;
  discountPaise: number;
  totalPaise: number;
  paymentMode: PaymentMode;
  discountApprovedBy: string | null; // supervisor/admin user id, or null
  createdBy: string; // acting user id
  // Set when this consultation is a RE-ISSUE correcting a voided bill (plan
  // §Part B): the id of that voided bill, linked to this new one in the SAME
  // transaction. Null for a normal consultation.
  replacesBillId?: string | null;
}

// Create a new consultation, its first visit, AND its consultation bill - all or
// nothing in one transaction. The bill gets its DB-issued bill_number (the token
// shown to the patient). Returns the ids and that number, plus whether a
// re-issue link was established (only a voided, not-yet-replaced source links).
export async function createConsultationWithBill(
  input: CreateConsultationInput,
): Promise<{ consultationId: string; billId: string; billNumber: string; replacedBillId: string | null }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cons = await client.query<{ id: string }>(
      `INSERT INTO consultations
         (patient_id, doctor_id, fee_charged_paise, valid_until, reason, location_id)
       VALUES ($1, $2, $3, $4::date, $5, $6)
       RETURNING id`,
      [
        input.patientId,
        input.doctorId,
        input.feeChargedPaise,
        input.validUntil,
        input.reason,
        input.locationId,
      ],
    );
    const consultationId = cons.rows[0].id;
    // First visit carries the same reason as its note, so every visit row has
    // context (revisits add their own notes).
    await client.query(`INSERT INTO visits (consultation_id, note) VALUES ($1, $2)`, [
      consultationId,
      input.reason,
    ]);
    const bill = await client.query<{ id: string; bill_number: string }>(
      `INSERT INTO bills
         (patient_id, type, consultation_id, subtotal_paise, discount_paise, total_paise,
          status, payment_mode, discount_approved_by, created_by, location_id)
       VALUES ($1, 'consultation', $2, $3, $4, $5, 'final', $6, $7, $8, $9)
       RETURNING id, bill_number`,
      [
        input.patientId,
        consultationId,
        input.subtotalPaise,
        input.discountPaise,
        input.totalPaise,
        input.paymentMode,
        input.discountApprovedBy,
        input.createdBy,
        input.locationId,
      ],
    );
    // Re-issue link (plan §Part B): point the voided source bill at this new one,
    // in the same transaction. GUARDED (status = 'void' AND not-yet-replaced) so
    // the link is one-shot - if the source was already replaced or isn't void,
    // nothing is linked and the new bill still stands on its own.
    let replacedBillId: string | null = null;
    if (input.replacesBillId) {
      const link = await client.query(
        `UPDATE bills
            SET replaced_by_bill_id = $1
          WHERE id = $2 AND status = 'void' AND replaced_by_bill_id IS NULL`,
        [bill.rows[0].id, input.replacesBillId],
      );
      if (link.rowCount === 1) replacedBillId = input.replacesBillId;
    }
    await client.query("COMMIT");
    return {
      consultationId,
      billId: bill.rows[0].id,
      billNumber: bill.rows[0].bill_number,
      replacedBillId,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Record a free revisit: another visit under an existing, still-valid
// consultation, with an optional note. No fee, no bill, no new consultation
// (PROJECT_OVERVIEW §Consult).
export async function recordRevisit(
  consultationId: string,
  note: string | null,
): Promise<void> {
  await pool.query(
    `INSERT INTO visits (consultation_id, note) VALUES ($1, $2)`,
    [consultationId, note],
  );
}

// Last visit day per patient (max visited_at across all their consultations), as
// 'YYYY-MM-DD' - shown in the picker. Patients with no visit are simply absent
// from the map. One query for the whole result set (no N+1).
export async function getLastVisitDates(
  patientIds: string[],
): Promise<Record<string, string>> {
  if (patientIds.length === 0) return {};
  const { rows } = await pool.query<{ patient_id: string; last_visit: string }>(
    `SELECT c.patient_id,
            to_char(max(v.visited_at), 'YYYY-MM-DD') AS last_visit
       FROM visits v
       JOIN consultations c ON c.id = v.consultation_id
      WHERE c.patient_id = ANY($1::bigint[])
      GROUP BY c.patient_id`,
    [patientIds],
  );
  const out: Record<string, string> = {};
  for (const r of rows) out[r.patient_id] = r.last_visit;
  return out;
}

// A row in the "all consultations" list: the consultation plus its patient,
// doctor, visit count, and finalized bill (money as paise strings, formatted in
// the UI). created_label is pre-formatted in the clinic time zone so the client
// never touches a raw timestamp.
export interface ConsultationListRow {
  id: string;
  created_label: string;
  patient_name: string;
  patient_code: string;
  phone: string | null;
  doctor_name: string;
  reason: string | null;
  visit_count: number;
  fee_charged_paise: string;
  bill_id: string | null; // null for a free revisit (no bill) - print plan §5b
  bill_number: string | null;
  total_paise: string | null;
  discount_paise: string | null;
  payment_mode: string | null;
  // Void + re-issue (plan). null when there's no bill (free revisit).
  bill_status: string | null; // 'final' | 'pending_approval' | 'void'
  void_reason: string | null;
  voided_by_name: string | null;
  replaced_by_number: string | null; // this (voided) bill's replacement, if any
  reissue_of_number: string | null; // the voided bill this one re-issued, if any
}

export interface ConsultationFilters {
  q?: string; // free text: patient name/phone/code, or doctor name
  dateFrom?: IsoDay; // inclusive, clinic calendar day
  dateTo?: IsoDay; // inclusive, clinic calendar day
}

// The most recent consultations, newest first, narrowed by any combination of
// filters (all optional - an absent one doesn't filter). Capped; search-first,
// not a full dump. Built as a dynamic WHERE clause since any subset of filters
// may be active at once, but every value is still bound as a query parameter -
// never string-interpolated. Mirrors lib/procedures/repository.ts's
// listProcedureBills.
export async function listConsultations(
  filters: ConsultationFilters = {},
  limit = 100,
): Promise<ConsultationListRow[]> {
  const conditions: string[] = ["true"];
  const params: unknown[] = [];

  const q = filters.q?.trim();
  if (q) {
    params.push(q);
    const i = params.length;
    conditions.push(
      `(p.name ILIKE '%' || $${i} || '%'
        OR p.phone LIKE $${i} || '%'
        OR p.patient_code ILIKE '%' || $${i} || '%'
        OR d.name ILIKE '%' || $${i} || '%')`,
    );
  }
  if (filters.dateFrom) {
    params.push(filters.dateFrom);
    conditions.push(`c.created_at >= $${params.length}::date`);
  }
  if (filters.dateTo) {
    // Exclusive upper bound (the next day) so the whole "to" day is included
    // regardless of time-of-day, without truncating created_at's index use.
    params.push(filters.dateTo);
    conditions.push(`c.created_at < ($${params.length}::date + interval '1 day')`);
  }

  params.push(limit);
  const limitParam = params.length;

  const { rows } = await pool.query<ConsultationListRow>(
    `SELECT c.id,
            to_char(c.created_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY, HH24:MI') AS created_label,
            p.name        AS patient_name,
            p.patient_code,
            p.phone,
            d.name        AS doctor_name,
            c.reason,
            (SELECT count(*) FROM visits v WHERE v.consultation_id = c.id)::int AS visit_count,
            c.fee_charged_paise::text,
            b.id::text AS bill_id,
            b.bill_number::text,
            b.total_paise::text,
            b.discount_paise::text,
            b.payment_mode,
            b.status AS bill_status,
            b.void_reason,
            vb.name AS voided_by_name,
            rb.bill_number::text AS replaced_by_number,
            ob.bill_number::text AS reissue_of_number
       FROM consultations c
       JOIN patients p ON p.id = c.patient_id
       JOIN doctors  d ON d.id = c.doctor_id
       -- MUST filter to the consultation-TYPE bill: procedure bills also carry
       -- a consultation_id (they're billed against a consultation), so an
       -- unfiltered join picks THEM up too - producing duplicate rows AND a
       -- bill_id that points at a procedure bill, which then reprints the
       -- procedure receipt (items table + wrong template) for a consultation.
       LEFT JOIN bills b ON b.consultation_id = c.id AND b.type = 'consultation'
       LEFT JOIN users vb ON vb.id = b.voided_by            -- who voided it
       LEFT JOIN bills rb ON rb.id = b.replaced_by_bill_id  -- its replacement (Replaced by #)
       LEFT JOIN bills ob ON ob.replaced_by_bill_id = b.id  -- the bill it re-issued (Re-issue of #)
      WHERE ${conditions.join(" AND ")}
      ORDER BY c.created_at DESC
      LIMIT $${limitParam}`,
    params,
  );
  return rows;
}
