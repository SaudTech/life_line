import type { AnyBillDocument, BillDocument } from "./bill-document";

// The field catalog - single source of truth for every field a receipt
// template may bind to (plan §3d). Three things read this ONE registry so they
// can never drift apart:
//   1. the builder's "insert field" palette (filtered to the selected type),
//   2. save validation - a saved template may only reference keys valid for
//      its bill_type,
//   3. billDocumentToInputs below, which must emit exactly these keys since
//      that's what the pdfme template's field `name`s bind to.
// PURE and client-safe - no DB, no React.

export type BillType = "consultation" | "procedure" | "ip";

// How a field is rendered on the page:
//   - "labeled": the common case - a pdfme `multiVariableText` field whose
//     text is "<Label>: {key}", so the label is baked into the field itself
//     and survives generation. A plain `text` field can't do this: its whole
//     `content` is REPLACED by the input value at generate time, so a
//     hand-typed "Bill No: 1042" placeholder loses "Bill No:" the moment a
//     real value is substituted - this bit the admin builder for every field
//     until multiVariableText was used here.
//   - "plain": a bare `text` field with no label - the letterhead heading
//     (hospital name/address/phone) and the DUPLICATE/VOID watermark read
//     wrong with a label prefixed onto them.
//   - "table": the `table` field type (line items / expenses).
export type FieldKind = "labeled" | "plain" | "table";

export interface FieldMeta {
  key: string;
  // Descriptive name shown in the builder's "insert field" palette.
  label: string;
  // Concise label printed on the receipt ("<printLabel>: value"). Defaults to
  // `label` when omitted - only set it where the palette name is too verbose
  // for paper (e.g. palette "Valid until (free revisit window)" → print
  // "Valid until"). labelFor() resolves this.
  printLabel?: string;
  sample: string;
  kind: FieldKind;
}

function labeled(key: string, label: string, sample: string, printLabel?: string): FieldMeta {
  return { key, label, sample, kind: "labeled", printLabel };
}

// Every bill type shares these (hospital letterhead, bill/patient/payment/totals).
const COMMON_FIELDS: FieldMeta[] = [
  { key: "hospitalName", label: "Hospital name", sample: "Life Line", kind: "plain" },
  { key: "hospitalTagline", label: "Hospital tagline", sample: "A MULTI SPECIALITY HOSPITAL", kind: "plain" },
  {
    key: "hospitalAddress",
    label: "Hospital address",
    sample: "Chandrayangutta 'X' Road, Hyderabad - 500 005",
    kind: "plain",
  },
  {
    key: "hospitalPhone",
    label: "Hospital phone",
    sample: "Tel: 6309192617, 6309192618, 7382003300",
    kind: "plain",
  },
  labeled("billNumber", "Bill number", "1042", "Bill No"),
  labeled("billDateText", "Bill date", "09 Jul 2026", "Date"),
  labeled("billTimeText", "Bill time", "11:30 AM", "Time"),
  {
    key: "billStatusLabel",
    label: "Status watermark (DUPLICATE / VOID)",
    sample: "",
    kind: "plain",
  },
  labeled("patientCode", "Patient ID", "LL000123", "Patient ID"),
  labeled("patientName", "Patient name", "Asha Rao", "Name"),
  labeled("patientAgeGender", "Patient age / gender", "34 / Female", "Age / Gender"),
  labeled("patientPhone", "Patient phone", "9876543210", "Phone"),
  labeled("patientArea", "Patient area", "Kukatpally", "Area"),
  labeled("paymentModeLabel", "Payment mode", "Cash", "Payment"),
  labeled("cashierName", "Cashier", "Meera"),
  labeled("subtotalText", "Subtotal", "500.00"),
  labeled("discountText", "Discount", "50.00"),
  labeled("totalText", "Total", "450.00"),
  labeled("totalInWords", "Total in words", "Four Hundred Fifty Rupees Only", "In words"),
  {
    key: "footerNote",
    label: "Footer note",
    sample: "Thank you. Get well soon.",
    kind: "plain",
  },
];

const CONSULTATION_FIELDS: FieldMeta[] = [
  labeled("doctorName", "Doctor", "Dr. Anita Rao"),
  labeled("reason", "Reason for visit", "Fever", "Reason"),
  labeled("validUntilText", "Valid until (free revisit window)", "16 Jul 2026", "Valid until"),
];

const PROCEDURE_FIELDS: FieldMeta[] = [
  { key: "items", label: "Line items (table)", sample: "", kind: "table" },
];

const IP_FIELDS: FieldMeta[] = [
  labeled("admittedText", "Admitted on", "01 Jul 2026"),
  labeled("dischargedText", "Discharged on", "05 Jul 2026"),
  labeled("roomChargeText", "Room charge", "2,000.00"),
  labeled("advanceText", "Advance paid", "5,000.00"),
  { key: "expenses", label: "Expenses (table)", sample: "", kind: "table" },
  labeled("balanceText", "Payable balance", "-500.00"),
];

const FIELDS_BY_TYPE: Record<BillType, FieldMeta[]> = {
  consultation: [...COMMON_FIELDS, ...CONSULTATION_FIELDS],
  procedure: [...COMMON_FIELDS, ...PROCEDURE_FIELDS],
  ip: [...COMMON_FIELDS, ...IP_FIELDS],
};

// The palette for a given bill type - COMMON fields plus that type's own.
export function fieldsForType(type: BillType): FieldMeta[] {
  return FIELDS_BY_TYPE[type];
}

export function fieldKeysForType(type: BillType): string[] {
  return fieldsForType(type).map((f) => f.key);
}

export function isKnownField(type: BillType, key: string): boolean {
  return fieldKeysForType(type).includes(key);
}

// Look up a field's kind across every catalog (a saved template's fields don't
// carry their bill type at validation time) - used by billDocumentToInputs to
// decide the wire shape and by the admin builder to decide what schema type to
// insert. Falls back to "labeled" (the common case) for an unknown key; the
// value is discarded anyway since it's outside every catalog.
const KIND_BY_KEY: Record<string, FieldKind> = Object.fromEntries(
  [...COMMON_FIELDS, ...CONSULTATION_FIELDS, ...PROCEDURE_FIELDS, ...IP_FIELDS].map((f) => [
    f.key,
    f.kind,
  ]),
);

export function fieldKind(key: string): FieldKind {
  return KIND_BY_KEY[key] ?? "labeled";
}

// The PRINT label for a key (printLabel, else the palette label) - the wording
// baked into a seeded labeled field's "<Label>: {key}" text
// (lib/printing/defaults/build.ts's labeledField). Kept concise for paper.
const PRINT_LABEL_BY_KEY: Record<string, string> = Object.fromEntries(
  [...COMMON_FIELDS, ...CONSULTATION_FIELDS, ...PROCEDURE_FIELDS, ...IP_FIELDS].map((f) => [
    f.key,
    f.printLabel ?? f.label,
  ]),
);

export function labelFor(key: string): string {
  return PRINT_LABEL_BY_KEY[key] ?? key;
}

// Fixed fake data per type, for the builder's "Preview" button - a realistic
// receipt with no real bill/patient involved (plan §3d).
export function sampleBillDocument(type: BillType): AnyBillDocument {
  const common: BillDocument = {
    type,
    locationId: "0", // sample data only - never a real location
    hospital: {
      name: "Life Line",
      tagline: "A MULTI SPECIALITY HOSPITAL",
      address: "Chandrayangutta 'X' Road, Hyderabad - 500 005",
      phone: "Tel: 6309192617, 6309192618, 7382003300",
    },
    bill: { number: "1042", dateText: "09 Jul 2026", timeText: "11:30 AM" },
    patient: {
      code: "LL000123",
      name: "Asha Rao",
      ageGender: "34 / Female",
      phone: "9876543210",
      area: "Kukatpally",
    },
    payment: { modeLabel: "Cash", cashierName: "Meera" },
    totals: {
      subtotalText: "500.00",
      discountText: "50.00",
      totalText: "450.00",
      totalInWords: "Four Hundred Fifty Rupees Only",
    },
    footerNote: "Thank you. Get well soon.",
  };

  if (type === "consultation") {
    return {
      ...common,
      type: "consultation",
      doctorName: "Dr. Anita Rao",
      reason: "Fever",
      validUntilText: "16 Jul 2026",
    };
  }
  if (type === "procedure") {
    return {
      ...common,
      type: "procedure",
      items: [
        { desc: "IV Fluid", qty: "2", unitText: "150.00", lineText: "300.00" },
        { desc: "Injection", qty: "1", unitText: "150.00", lineText: "150.00" },
      ],
    };
  }
  return {
    ...common,
    type: "ip",
    admittedText: "01 Jul 2026",
    dischargedText: "05 Jul 2026",
    roomChargeText: "2,000.00",
    advanceText: "5,000.00",
    expenses: [{ item: "Dressing", qty: "3", amountText: "300.00" }],
    balanceText: "-2,150.00",
  };
}

// Flatten a resolved BillDocument into the string map pdfme's
// generate({ template, inputs }) expects, keyed by exactly the field catalog's
// keys above. The WIRE SHAPE of each value depends on the field kind (the one
// place that mapping is made, so a template field and its input can never
// silently disagree):
//   - "plain"   → the raw value, verbatim.
//   - "labeled" → JSON.stringify({ [key]: value }) - pdfme's multiVariableText
//     input format (a JSON object of variable name → value), substituted into
//     that field's "<Label>: {key}" text at generate time.
//   - "table"   → JSON.stringify of a 2D array of cell strings (items/expenses,
//     handled directly below - never routed through the labeled/plain wrap).
function wire(key: string, value: string): string {
  return fieldKind(key) === "labeled" ? JSON.stringify({ [key]: value }) : value;
}

export function billDocumentToInputs(doc: AnyBillDocument): Record<string, string> {
  const raw: Record<string, string> = {
    hospitalName: doc.hospital.name,
    hospitalTagline: doc.hospital.tagline ?? "",
    hospitalAddress: doc.hospital.address ?? "",
    hospitalPhone: doc.hospital.phone ?? "",
    billNumber: doc.bill.number,
    billDateText: doc.bill.dateText,
    billTimeText: doc.bill.timeText,
    billStatusLabel: doc.bill.statusLabel ?? "",
    patientCode: doc.patient.code,
    patientName: doc.patient.name,
    patientAgeGender: doc.patient.ageGender ?? "",
    patientPhone: doc.patient.phone ?? "",
    patientArea: doc.patient.area ?? "",
    paymentModeLabel: doc.payment.modeLabel ?? "",
    cashierName: doc.payment.cashierName,
    subtotalText: doc.totals.subtotalText,
    discountText: doc.totals.discountText ?? "",
    totalText: doc.totals.totalText,
    totalInWords: doc.totals.totalInWords,
    footerNote: doc.footerNote ?? "",
  };

  if (doc.type === "consultation") {
    raw.doctorName = doc.doctorName;
    raw.reason = doc.reason ?? "";
    raw.validUntilText = doc.validUntilText;
  } else if (doc.type === "procedure") {
    raw.items = JSON.stringify(doc.items.map((i) => [i.desc, i.qty, i.unitText, i.lineText]));
  } else {
    raw.admittedText = doc.admittedText;
    raw.dischargedText = doc.dischargedText ?? "";
    raw.roomChargeText = doc.roomChargeText;
    raw.advanceText = doc.advanceText;
    raw.expenses = JSON.stringify(doc.expenses.map((e) => [e.item, e.qty, e.amountText]));
    raw.balanceText = doc.balanceText;
  }

  const inputs: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    inputs[key] = fieldKind(key) === "table" ? value : wire(key, value);
  }
  return inputs;
}
