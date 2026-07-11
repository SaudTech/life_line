import { formatPaise } from "@/lib/money";
import { amountInWords } from "./amount-in-words";

// PURE render-model + input mapping for the A4 "Advance Deposit Receipt" (plan
// §5b) - the patient's proof of the advance handed over at admission. This is NOT
// a `bills` row (no bill exists until discharge), so it has its OWN small,
// self-contained field set rather than the bill field catalog. Kept pure (no DB)
// so it's unit-testable; the DB resolver lives in ./advance-receipt-repository.
//
// The template (lib/printing/defaults/advance-receipt.ts) is a built-in FIXED A4
// layout of plain text + static captions, so each value maps to its field name
// verbatim (no multiVariableText wrapping). Reuses the same formatPaise +
// amount-in-words + clinic-tz date + hospital letterhead as BillDocument.

const PAYMENT_MODE_LABELS: Record<string, string> = {
  cash: "Cash",
  card: "Card",
  upi: "UPI",
  other: "Other",
};

export interface AdvanceReceiptDocument {
  // Not a template field - carried so the print route can pick the right
  // location's letterhead (mirrors BillDocument.locationId).
  locationId: string;
  hospital: { name: string; tagline?: string; address?: string; phone?: string };
  // The admission id doubles as the receipt reference (the "receipt number" for
  // proof); no bill number exists yet.
  reference: string;
  admittedDateText: string;
  patient: { code: string; name: string; ageGender?: string; phone?: string };
  advanceText: string;
  advanceInWords: string;
  paymentModeLabel?: string;
  footerNote?: string;
}

export interface AdvanceReceiptCore {
  locationId: string;
  hospitalName: string;
  hospitalTagline: string | null;
  hospitalAddress: string | null;
  hospitalPhone: string | null;
  footerNote: string | null;
  admissionId: string;
  admittedDateText: string; // pre-formatted in the clinic tz (SQL to_char)
  advancePaise: string | number;
  paymentMode: string | null;
  patientCode: string;
  patientName: string;
  patientAge: number | null;
  patientGender: string | null;
  patientPhone: string | null;
}

// "62 / Female" / just "62" / just "Female" / undefined (mirrors bill-document).
function ageGenderText(age: number | null, gender: string | null): string | undefined {
  const genderText = gender ? gender[0].toUpperCase() + gender.slice(1) : null;
  const parts = [age != null ? String(age) : null, genderText].filter(
    (p): p is string => p !== null,
  );
  return parts.length ? parts.join(" / ") : undefined;
}

// PURE mapper from a fetched core row to the render model.
export function buildAdvanceReceiptDocument(core: AdvanceReceiptCore): AdvanceReceiptDocument {
  return {
    locationId: core.locationId,
    hospital: {
      name: core.hospitalName,
      tagline: core.hospitalTagline ?? undefined,
      address: core.hospitalAddress ?? undefined,
      phone: core.hospitalPhone ?? undefined,
    },
    reference: core.admissionId,
    admittedDateText: core.admittedDateText,
    patient: {
      code: core.patientCode,
      name: core.patientName,
      ageGender: ageGenderText(core.patientAge, core.patientGender),
      phone: core.patientPhone ?? undefined,
    },
    advanceText: formatPaise(core.advancePaise),
    advanceInWords: amountInWords(core.advancePaise),
    paymentModeLabel: core.paymentMode ? PAYMENT_MODE_LABELS[core.paymentMode] : undefined,
    footerNote: core.footerNote ?? undefined,
  };
}

// Flatten to the string map pdfme's generate({ template, inputs }) expects, keyed
// by exactly the template's field names (advance-receipt default template). Plain
// text fields take the raw value - no labeled/JSON wrapping.
export function advanceReceiptToInputs(doc: AdvanceReceiptDocument): Record<string, string> {
  return {
    hospitalName: doc.hospital.name,
    hospitalTagline: doc.hospital.tagline ?? "",
    hospitalAddress: doc.hospital.address ?? "",
    hospitalPhone: doc.hospital.phone ?? "",
    receiptRef: doc.reference,
    admittedDateText: doc.admittedDateText,
    patientCode: doc.patient.code,
    patientName: doc.patient.name,
    patientAgeGender: doc.patient.ageGender ?? "",
    patientPhone: doc.patient.phone ?? "",
    advanceText: doc.advanceText,
    advanceInWords: doc.advanceInWords,
    paymentModeLabel: doc.paymentModeLabel ?? "",
    footerNote: doc.footerNote ?? "",
  };
}
