import { formatRupees } from "@/lib/money";
import { fieldKind } from "./fields";
import { amountInWords } from "./amount-in-words";

// PURE render-model + input mapping for the A4 "Advance Deposit Receipt" (plan
// §5b) - the patient's proof of the advance handed over at admission. This is NOT
// a `bills` row (no bill exists until discharge), so it has its OWN document
// shape; its designable field set is the `advance` catalog in ./fields (the
// designer's palette, save validation, and this mapping all read that ONE
// registry). Kept pure (no DB) so it's unit-testable; the DB resolver lives in
// ./advance-receipt-repository. Reuses the same formatPaise + amount-in-words +
// clinic-tz date + hospital letterhead as BillDocument.

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
    advanceText: formatRupees(core.advancePaise),
    advanceInWords: amountInWords(core.advancePaise),
    paymentModeLabel: core.paymentMode ? PAYMENT_MODE_LABELS[core.paymentMode] : undefined,
    footerNote: core.footerNote ?? undefined,
  };
}

// Flatten to the string map pdfme's generate({ template, inputs }) expects,
// keyed by exactly the `advance` field catalog's keys (./fields). The wire shape
// per key is decided by that catalog's kind - the SAME rule billDocumentToInputs
// applies - so a designed field and its input can never silently disagree:
//   - "plain"   → the raw value, verbatim (the big amount, letterhead, footer).
//   - "labeled" → JSON.stringify({ [key]: value }) - pdfme's multiVariableText
//     input format, substituted into the field's "<Label>: {key}" text.
export function advanceReceiptToInputs(doc: AdvanceReceiptDocument): Record<string, string> {
  const raw: Record<string, string> = {
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
    paymentModeLabel: doc.paymentModeLabel ?? "",
    advanceAmountText: doc.advanceText,
    advanceInWords: doc.advanceInWords,
    footerNote: doc.footerNote ?? "",
  };
  const inputs: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    inputs[key] = fieldKind(key) === "labeled" ? JSON.stringify({ [key]: value }) : value;
  }
  return inputs;
}

// Fixed fake data for the designer's "Preview" button (mirrors ./fields'
// sampleBillDocument, which covers the bill types - advance isn't a
// BillDocument, so its sample lives here beside its own document shape).
export function sampleAdvanceReceiptDocument(): AdvanceReceiptDocument {
  return {
    locationId: "0", // sample data only - never a real location
    hospital: {
      name: "Life Line",
      tagline: "A MULTI SPECIALITY HOSPITAL",
      address: "Chandrayangutta 'X' Road, Hyderabad - 500 005",
      phone: "Tel: 6309192617, 6309192618, 7382003300",
    },
    reference: "128",
    admittedDateText: "01 Jul 2026",
    patient: {
      code: "LL000123",
      name: "Asha Rao",
      ageGender: "34 / Female",
      phone: "9876543210",
    },
    advanceText: "₹5,000.00",
    advanceInWords: "Five Thousand Rupees Only",
    paymentModeLabel: "Cash",
    footerNote: "This advance will be adjusted against the final bill at discharge.",
  };
}
