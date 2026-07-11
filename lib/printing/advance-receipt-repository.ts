import { pool } from "@/lib/db";
import { buildAdvanceReceiptDocument, type AdvanceReceiptDocument } from "./advance-receipt";

// DB-backed resolver for the advance-deposit receipt (plan §5b). Thin: one query
// for the admission + its patient + the location's letterhead, then the pure
// builder in ./advance-receipt shapes the result. Kept separate from the pure
// module so the shaping logic stays unit-testable without a database (dev-rules
// §2). Mirrors bill-document-repository.ts.

interface CoreRow {
  location_id: string;
  admission_id: string;
  admitted_date_text: string;
  advance_paid_paise: string;
  advance_payment_mode: string | null;
  patient_code: string;
  patient_name: string;
  patient_age: number | null;
  patient_gender: string | null;
  patient_phone: string | null;
  hospital_name: string;
  hospital_tagline: string | null;
  hospital_address: string | null;
  hospital_phone: string | null;
  footer_note: string | null;
}

// Full render model for an admission's advance receipt, by admission id. Throws if
// the admission doesn't exist - the caller (the print route) confirms it via the
// query result.
export async function getAdvanceReceiptDocument(
  admissionId: string,
): Promise<AdvanceReceiptDocument> {
  const { rows } = await pool.query<CoreRow>(
    `SELECT a.location_id::text,
            a.id::text                                     AS admission_id,
            to_char(a.admitted_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY') AS admitted_date_text,
            a.advance_paid_paise::text,
            a.advance_payment_mode,
            p.patient_code,
            p.name                                         AS patient_name,
            p.age                                          AS patient_age,
            p.gender                                       AS patient_gender,
            p.phone                                        AS patient_phone,
            COALESCE(hp.name, l.name)                      AS hospital_name,
            hp.tagline                                     AS hospital_tagline,
            hp.address                                     AS hospital_address,
            hp.phone                                       AS hospital_phone,
            hp.footer_note                                 AS footer_note
       FROM admissions a
       JOIN patients p ON p.id = a.patient_id
       JOIN locations l ON l.id = a.location_id
       LEFT JOIN hospital_profile hp ON hp.location_id = a.location_id
      WHERE a.id = $1`,
    [admissionId],
  );
  const core = rows[0];
  if (!core) {
    throw new Error(`Admission ${admissionId} not found`);
  }
  return buildAdvanceReceiptDocument({
    locationId: core.location_id,
    hospitalName: core.hospital_name,
    hospitalTagline: core.hospital_tagline,
    hospitalAddress: core.hospital_address,
    hospitalPhone: core.hospital_phone,
    footerNote: core.footer_note,
    admissionId: core.admission_id,
    admittedDateText: core.admitted_date_text,
    advancePaise: core.advance_paid_paise,
    paymentMode: core.advance_payment_mode,
    patientCode: core.patient_code,
    patientName: core.patient_name,
    patientAge: core.patient_age,
    patientGender: core.patient_gender,
    patientPhone: core.patient_phone,
  });
}
