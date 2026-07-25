import { pool } from "@/lib/db";
import {
  buildConsultationDocument,
  buildProcedureDocument,
  buildIpDocument,
  type BillDocumentUnion,
  type BillDocumentCore,
} from "./bill-document";

// DB-backed resolver (plan §3a). Thin: one query for the shared core +
// hospital letterhead, one more for the type-specific data, then the pure
// builders in ./bill-document shape the result. No bill-fetch-by-id helper
// existed before this - it lives here since nothing else needs a bare bill row
// today. Kept in its own file (not bill-document.ts) so the pure shaping logic
// stays importable/unit-testable without a database (dev-rules §2).

interface CoreRow {
  location_id: string;
  bill_number: string;
  date_text: string;
  time_text: string;
  status: "final" | "pending_approval" | "void";
  subtotal_paise: string;
  discount_paise: string;
  total_paise: string;
  payment_mode: string | null;
  type: "consultation" | "procedure" | "ip";
  consultation_id: string | null;
  admission_id: string | null;
  patient_code: string;
  patient_name: string;
  patient_age: number | null;
  patient_gender: string | null;
  patient_phone: string | null;
  patient_area: string | null;
  cashier_name: string;
  hospital_name: string;
  hospital_tagline: string | null;
  hospital_address: string | null;
  hospital_phone: string | null;
  footer_note: string | null;
}

const CORE_QUERY = `
  SELECT b.location_id::text,
         b.bill_number::text,
         to_char(b.created_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY') AS date_text,
         to_char(b.created_at AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM') AS time_text,
         b.status,
         b.subtotal_paise::text,
         b.discount_paise::text,
         b.total_paise::text,
         b.payment_mode,
         b.type,
         b.consultation_id::text,
         b.admission_id::text,
         p.patient_code,
         p.name                                        AS patient_name,
         p.age                                          AS patient_age,
         p.gender                                       AS patient_gender,
         p.phone                                        AS patient_phone,
         p.area                                          AS patient_area,
         u.name                                          AS cashier_name,
         COALESCE(hp.name, l.name)                       AS hospital_name,
         hp.tagline                                       AS hospital_tagline,
         hp.address                                      AS hospital_address,
         hp.phone                                        AS hospital_phone,
         hp.footer_note                                   AS footer_note
    FROM bills b
    JOIN patients p ON p.id = b.patient_id
    JOIN users u ON u.id = b.created_by
    JOIN locations l ON l.id = b.location_id
    LEFT JOIN hospital_profile hp ON hp.location_id = b.location_id
   WHERE b.id = $1
`;

// Full render model for a saved bill, by id. Throws if the bill doesn't exist
// or its type isn't shipped yet (`ip`) - the caller (builder preview / the
// later print step) is expected to have already confirmed the bill exists.
export async function getBillDocument(billId: string): Promise<BillDocumentUnion> {
  const { rows } = await pool.query<CoreRow>(CORE_QUERY, [billId]);
  const core = rows[0];
  if (!core) {
    throw new Error(`Bill ${billId} not found`);
  }

  const coreInput: BillDocumentCore = {
    locationId: core.location_id,
    hospitalName: core.hospital_name,
    hospitalTagline: core.hospital_tagline,
    hospitalAddress: core.hospital_address,
    hospitalPhone: core.hospital_phone,
    footerNote: core.footer_note,
    billNumber: core.bill_number,
    dateText: core.date_text,
    timeText: core.time_text,
    status: core.status,
    subtotalPaise: core.subtotal_paise,
    discountPaise: core.discount_paise,
    totalPaise: core.total_paise,
    paymentMode: core.payment_mode,
    patientCode: core.patient_code,
    patientName: core.patient_name,
    patientAge: core.patient_age,
    patientGender: core.patient_gender,
    patientPhone: core.patient_phone,
    patientArea: core.patient_area,
    cashierName: core.cashier_name,
  };

  if (core.type === "consultation") {
    const { rows: consultRows } = await pool.query<{
      doctor_id: string;
      doctor_name: string;
      reason: string | null;
      valid_until_text: string;
    }>(
      // doctor_id is not a printable field - it is carried so the print route
      // can pick this doctor's own consultation design (migration 0024).
      `SELECT d.id::text AS doctor_id, d.name AS doctor_name, c.reason, to_char(c.valid_until, 'DD Mon YYYY') AS valid_until_text
         FROM consultations c
         JOIN doctors d ON d.id = c.doctor_id
        WHERE c.id = $1`,
      [core.consultation_id],
    );
    const consultation = consultRows[0];
    if (!consultation) {
      throw new Error(`Consultation for bill ${billId} not found`);
    }
    return buildConsultationDocument(coreInput, {
      doctorId: consultation.doctor_id,
      doctorName: consultation.doctor_name,
      reason: consultation.reason,
      validUntilText: consultation.valid_until_text,
      consultationNumber: core.consultation_id!,
    });
  }

  if (core.type === "procedure") {
    const { rows: items } = await pool.query<{
      description: string;
      quantity: number;
      unit_price_paise: string;
      line_total_paise: string;
    }>(
      `SELECT description, quantity, unit_price_paise::text, line_total_paise::text
         FROM bill_items
        WHERE bill_id = $1
        ORDER BY id`,
      [billId],
    );
    return buildProcedureDocument(
      coreInput,
      items.map((i) => ({
        description: i.description,
        quantity: i.quantity,
        unitPricePaise: i.unit_price_paise,
        lineTotalPaise: i.line_total_paise,
      })),
    );
  }

  // ip (plan §6b): the discharge bill points back at its admission
  // (bills.admission_id). Pull the admission's admit/discharge dates, room charge,
  // and advance, plus its itemised expenses (admission_expenses, kept after
  // discharge), and shape the render model - the balance/refund is computed in the
  // pure builder from the bill total and the advance.
  const { rows: admRows } = await pool.query<{
    admitted_text: string;
    discharged_text: string | null;
    room_charge_paise: string;
    room_rate_paise: string | null;
    room_days: number | null;
    advance_paid_paise: string;
  }>(
    `SELECT to_char(admitted_at   AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY') AS admitted_text,
            to_char(discharged_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY') AS discharged_text,
            room_charge_paise::text,
            room_rate_paise::text,
            room_days,
            advance_paid_paise::text
       FROM admissions
      WHERE id = $1`,
    [core.admission_id],
  );
  const admission = admRows[0];
  if (!admission) {
    throw new Error(`Admission for bill ${billId} not found`);
  }
  const { rows: expenses } = await pool.query<{
    item: string;
    quantity: number;
    total_paise: string;
  }>(
    `SELECT item, quantity, total_paise::text
       FROM admission_expenses
      WHERE admission_id = $1
      ORDER BY id`,
    [core.admission_id],
  );
  return buildIpDocument(coreInput, {
    admittedText: admission.admitted_text,
    dischargedText: admission.discharged_text,
    roomChargePaise: admission.room_charge_paise,
    roomRatePaise: admission.room_rate_paise,
    roomDays: admission.room_days,
    advancePaise: admission.advance_paid_paise,
    expenses: expenses.map((e) => ({
      item: e.item,
      quantity: e.quantity,
      totalPaise: e.total_paise,
    })),
  });
}
