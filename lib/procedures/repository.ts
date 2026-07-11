import { pool } from "@/lib/db";
import type { IsoDay } from "@/lib/consultations/rules";
import type { PaymentMode } from "@/lib/consultations/repository";

// Data access for the OPD procedures flow (plan §Part2). Thin: queries only -
// the ACTIVE check is the pure rule isConsultationValid, invoked by the action;
// this layer just reads the candidate consultation(s) and writes the bill.
// Mirrors lib/consultations/repository.ts.

// A consultation as billed against: enough to show the doctor + validity and to
// re-check ACTIVE on the server before writing.
export interface ConsultationForBilling {
  id: string;
  doctor_name: string;
  valid_until: IsoDay;
}

// The same, plus the patient it belongs to - what the consultation-NUMBER lookup
// returns (the phone lookup already knows the patient from findPatientsByPhone).
export interface ConsultationByNumberRow extends ConsultationForBilling {
  patient_id: string;
  patient_code: string;
  patient_name: string;
  phone: string | null;
}

// Look up a single consultation by its bigint id (the "consultation number"
// shown to staff, plan §4C), with its patient + doctor. Null if it doesn't exist.
export async function getConsultationByNumber(
  id: string,
): Promise<ConsultationByNumberRow | null> {
  const { rows } = await pool.query<ConsultationByNumberRow>(
    `SELECT c.id::text                              AS id,
            to_char(c.valid_until, 'YYYY-MM-DD')     AS valid_until,
            d.name                                   AS doctor_name,
            p.id::text                                AS patient_id,
            p.patient_code,
            p.name                                   AS patient_name,
            p.phone
       FROM consultations c
       JOIN patients p ON p.id = c.patient_id
       JOIN doctors  d ON d.id = c.doctor_id
      WHERE c.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

// A patient's consultations that are STILL VALID today, newest first - the list
// the phone-lookup path picks from. Validity is reckoned in the clinic calendar
// day (the caller passes clinicToday()); comparing valid_until >= today in SQL
// keeps this a single indexed-enough query rather than fetching every
// consultation and filtering in JS.
export async function getActiveConsultationsForPatient(
  patientId: string,
  today: IsoDay,
): Promise<ConsultationForBilling[]> {
  const { rows } = await pool.query<ConsultationForBilling>(
    `SELECT c.id::text                          AS id,
            to_char(c.valid_until, 'YYYY-MM-DD') AS valid_until,
            d.name                               AS doctor_name
       FROM consultations c
       JOIN doctors d ON d.id = c.doctor_id
      WHERE c.patient_id = $1
        AND c.valid_until >= $2::date
      ORDER BY c.valid_until DESC, c.id DESC`,
    [patientId, today],
  );
  return rows;
}

// A row in the "all procedures" list: the bill plus its patient, the
// consultation it was billed against, and a summary of its lines (money as
// paise strings, formatted in the UI). created_label is pre-formatted in the
// clinic time zone (12-hour clock) so the client never touches a raw
// timestamp. Mirrors ConsultationListRow (consultations/repository.ts).
export interface ProcedureBillListRow {
  id: string;
  bill_number: string;
  created_label: string;
  patient_name: string;
  patient_code: string;
  phone: string | null;
  consultation_id: string | null;
  doctor_name: string | null;
  created_by_name: string | null;
  item_count: number;
  items_summary: string | null;
  subtotal_paise: string;
  discount_paise: string;
  total_paise: string;
  payment_mode: string | null;
  // Void + re-issue (plan).
  bill_status: string; // 'final' | 'pending_approval' | 'void'
  void_reason: string | null;
  voided_by_name: string | null;
  replaced_by_number: string | null; // this (voided) bill's replacement, if any
  reissue_of_number: string | null; // the voided bill this one re-issued, if any
}

export interface ProcedureBillFilters {
  q?: string; // free text: patient name/phone/code, doctor name, or bill number
  createdBy?: string; // user id (UUID)
  dateFrom?: IsoDay; // inclusive, clinic calendar day
  dateTo?: IsoDay; // inclusive, clinic calendar day
  minAmountPaise?: number;
  maxAmountPaise?: number;
  serviceId?: string; // only bills with at least one line of this service
}

// The most recent procedure bills, newest first, narrowed by any combination
// of filters (all optional - an absent one doesn't filter). Capped;
// search-first, not a full dump (mirrors listConsultations). Built as a
// dynamic WHERE clause since any subset of filters may be active at once, but
// every value is still bound as a query parameter - never string-interpolated.
export async function listProcedureBills(
  filters: ProcedureBillFilters = {},
  limit = 100,
): Promise<ProcedureBillListRow[]> {
  const conditions: string[] = [`b.type = 'procedure'`];
  const params: unknown[] = [];

  const q = filters.q?.trim();
  if (q) {
    params.push(q);
    const i = params.length;
    conditions.push(
      `(p.name ILIKE '%' || $${i} || '%'
        OR p.phone LIKE $${i} || '%'
        OR p.patient_code ILIKE '%' || $${i} || '%'
        OR b.bill_number::text ILIKE '%' || $${i} || '%'
        OR d.name ILIKE '%' || $${i} || '%')`,
    );
  }
  if (filters.createdBy) {
    params.push(filters.createdBy);
    conditions.push(`b.created_by = $${params.length}`);
  }
  if (filters.dateFrom) {
    params.push(filters.dateFrom);
    conditions.push(`b.created_at >= $${params.length}::date`);
  }
  if (filters.dateTo) {
    // Exclusive upper bound (the next day) so the whole "to" day is included
    // regardless of time-of-day, without truncating created_at's index use.
    params.push(filters.dateTo);
    conditions.push(`b.created_at < ($${params.length}::date + interval '1 day')`);
  }
  if (filters.minAmountPaise != null) {
    params.push(filters.minAmountPaise);
    conditions.push(`b.total_paise >= $${params.length}`);
  }
  if (filters.maxAmountPaise != null) {
    params.push(filters.maxAmountPaise);
    conditions.push(`b.total_paise <= $${params.length}`);
  }
  if (filters.serviceId) {
    params.push(filters.serviceId);
    conditions.push(
      `EXISTS (SELECT 1 FROM bill_items bi WHERE bi.bill_id = b.id AND bi.service_id = $${params.length})`,
    );
  }

  params.push(limit);
  const limitParam = params.length;

  const { rows } = await pool.query<ProcedureBillListRow>(
    `SELECT b.id::text                                                   AS id,
            b.bill_number::text,
            to_char(b.created_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM') AS created_label,
            p.name                                                       AS patient_name,
            p.patient_code,
            p.phone,
            b.consultation_id::text,
            d.name                                                       AS doctor_name,
            u.name                                                       AS created_by_name,
            (SELECT count(*) FROM bill_items bi WHERE bi.bill_id = b.id)::int AS item_count,
            (SELECT string_agg(bi.description || ' ×' || bi.quantity, ', ' ORDER BY bi.id)
               FROM bill_items bi WHERE bi.bill_id = b.id)               AS items_summary,
            b.subtotal_paise::text,
            b.discount_paise::text,
            b.total_paise::text,
            b.payment_mode,
            b.status AS bill_status,
            b.void_reason,
            vb.name AS voided_by_name,
            rb.bill_number::text AS replaced_by_number,
            ob.bill_number::text AS reissue_of_number
       FROM bills b
       JOIN patients p ON p.id = b.patient_id
       LEFT JOIN consultations c ON c.id = b.consultation_id
       LEFT JOIN doctors d ON d.id = c.doctor_id
       LEFT JOIN users u ON u.id = b.created_by
       LEFT JOIN users vb ON vb.id = b.voided_by            -- who voided it
       LEFT JOIN bills rb ON rb.id = b.replaced_by_bill_id  -- its replacement (Replaced by #)
       LEFT JOIN bills ob ON ob.replaced_by_bill_id = b.id  -- the bill it re-issued (Re-issue of #)
      WHERE ${conditions.join(" AND ")}
      ORDER BY b.created_at DESC
      LIMIT $${limitParam}`,
    params,
  );
  return rows;
}

export interface ProcedureLineInput {
  serviceId: string;
  description: string; // the service's current name, snapshotted
  quantity: number;
  unitPricePaise: number; // snapshotted from the service's current price_paise
  lineTotalPaise: number;
}

export interface CreateProcedureBillInput {
  // Null when the bill isn't linked to any consultation (plan follow-up: a
  // procedure can be billed standalone, not only against an active visit).
  consultationId: string | null;
  patientId: string;
  lines: ProcedureLineInput[];
  subtotalPaise: number;
  discountPaise: number;
  totalPaise: number;
  paymentMode: PaymentMode;
  discountApprovedBy: string | null;
  createdBy: string;
  locationId: string;
  // Set when this bill is a RE-ISSUE correcting a voided bill (plan §Part B):
  // the id of that voided bill, linked to this new one in the same transaction.
  replacesBillId?: string | null;
}

// Create a procedure bill + its service-line items, all or nothing (mirrors
// createConsultationWithBill). The bill gets its DB-issued bill_number. Returns
// whether a re-issue link was established (only a voided, not-yet-replaced
// source links).
export async function createProcedureBill(
  input: CreateProcedureBillInput,
): Promise<{ billId: string; billNumber: string; replacedBillId: string | null }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const bill = await client.query<{ id: string; bill_number: string }>(
      `INSERT INTO bills
         (patient_id, type, consultation_id, subtotal_paise, discount_paise, total_paise,
          status, payment_mode, discount_approved_by, created_by, location_id)
       VALUES ($1, 'procedure', $2, $3, $4, $5, 'final', $6, $7, $8, $9)
       RETURNING id, bill_number`,
      [
        input.patientId,
        input.consultationId,
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
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          billId,
          line.serviceId,
          line.description,
          line.quantity,
          line.unitPricePaise,
          line.lineTotalPaise,
        ],
      );
    }
    // Re-issue link (plan §Part B): point the voided source bill at this new one,
    // in the same transaction. GUARDED (status = 'void' AND not-yet-replaced) so
    // the link is one-shot.
    let replacedBillId: string | null = null;
    if (input.replacesBillId) {
      const link = await client.query(
        `UPDATE bills
            SET replaced_by_bill_id = $1
          WHERE id = $2 AND status = 'void' AND replaced_by_bill_id IS NULL`,
        [billId, input.replacesBillId],
      );
      if (link.rowCount === 1) replacedBillId = input.replacesBillId;
    }
    await client.query("COMMIT");
    return { billId, billNumber: bill.rows[0].bill_number, replacedBillId };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
