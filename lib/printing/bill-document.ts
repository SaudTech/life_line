import { formatRupees } from "@/lib/money";
import { amountInWords } from "./amount-in-words";

// PURE render-model types + shaping logic (no DB import here on purpose - the
// resolver that fetches rows and calls these lives in ./bill-document-repository,
// exactly so this file stays unit-testable without a database, matching this
// codebase's convention of pure rules/shaping functions separate from
// DB-querying repository.ts files, dev-rules §2).

// The normalized, display-ready render model a receipt template binds to
// (plan §3a). ALL money is pre-formatted to rupee strings here - the pdfme
// template does zero math and zero business logic (dev-rules: no logic in the
// UI/template, one source of truth per rule). Discriminated on `type` so the
// consultation/procedure/ip branches stay type-safe and each carries only the
// data that actually exists for that bill type.
export interface BillDocument {
  // Not a template field (never in the field catalog) - carried so the print
  // route can pick the right location's active template (print plan §3).
  locationId: string;
  hospital: { name: string; tagline?: string; address?: string; phone?: string };
  bill: {
    number: string;
    dateText: string;
    timeText: string;
    // "DUPLICATE" / "VOID" watermark hook for the (later) counter print step -
    // this plan only produces the field, nothing sets it yet (plan §6/§9).
    statusLabel?: string;
  };
  patient: { code: string; name: string; ageGender?: string; phone?: string; area?: string };
  payment: { modeLabel?: string; cashierName: string };
  totals: { subtotalText: string; discountText?: string; totalText: string; totalInWords: string };
  footerNote?: string;
  type: "consultation" | "procedure" | "ip";
}

export type ConsultationBillDocument = BillDocument & {
  type: "consultation";
  doctorName: string;
  reason?: string;
  validUntilText: string;
};

export type ProcedureBillDocument = BillDocument & {
  type: "procedure";
  items: { desc: string; qty: string; unitText: string; lineText: string }[];
};

export type IpBillDocument = BillDocument & {
  type: "ip";
  admittedText: string;
  dischargedText?: string;
  roomChargeText: string;
  advanceText: string;
  expenses: { item: string; qty: string; amountText: string }[];
  balanceText: string;
};

// The End-Day report render model (plan §4b). NOT a bill - it has no patient or
// payment; it is the day's close-out figures, ALREADY formatted to strings. All
// money math stays in the tested pure shaper (lib/reports/summary.ts); the
// resolver that builds this (lib/printing/end-day-document.ts) only reads those
// numbers and formats them (formatPaise), never sums or computes. Its keys line
// up 1:1 with the `end_day` field catalog (lib/printing/fields.ts).
export interface EndDayDocument {
  type: "end_day";
  // Not a template field - carried so the print route picks the right location's
  // active template (mirrors BillDocument.locationId).
  locationId: string;
  hospitalName: string;
  reportDateText: string; // the clinic day, e.g. "Saturday, 11 July 2026"
  staffNameRole: string; // "Meera · OP Desk" - whose day this is
  generatedAtText: string; // when the sheet was produced (clinic tz)
  grandTotalText: string; // total collected (excludes voids)
  billsCountText: string; // number of collected bills
  cashTotalText: string;
  cardTotalText: string;
  upiTotalText: string;
  otherTotalText: string;
  discountsText: string; // discount value given on the day's bills
  discountsApprovedText: string; // "450.00 (2)" - discounts I APPROVED (amount + count), a supervisor's own tally
  voidsText: string; // "1,200.00 (2)" - voided amount + count
  advancesText: string; // admission deposits collected
  advancesCountText: string; // "3" - number of advances taken (pairs with advancesText's amount)
  activityTotalText: string; // "19" - total logged actions on the day
  // Repeating rows for the designer's `table` fields (mode / type / activity).
  modeRows: { mode: string; count: string; amountText: string }[];
  typeRows: { label: string; count: string; amountText: string }[];
  activityRows: { label: string; count: string }[];
}

// The bill documents (a real bill, with hospital/patient/payment blocks) - the
// return of getBillDocument. Kept separate from AnyBillDocument so bill-only
// consumers (the [billId] PDF route) still see `.bill`/`.hospital`.
export type BillDocumentUnion =
  | ConsultationBillDocument
  | ProcedureBillDocument
  | IpBillDocument;

// Every document a receipt/report template can be fed - bills plus the End-Day
// report. billDocumentToInputs branches on `type` to shape each.
export type AnyBillDocument = BillDocumentUnion | EndDayDocument;

const PAYMENT_MODE_LABELS: Record<string, string> = {
  cash: "Cash",
  card: "Card",
  upi: "UPI",
  other: "Other",
};

const STATUS_LABELS: Record<string, string> = {
  pending_approval: "PENDING APPROVAL",
  void: "VOID",
};

// "62 / Female" / just "62" / just "Female" / undefined if neither is known.
function ageGenderText(age: number | null, gender: string | null): string | undefined {
  const genderText = gender ? gender[0].toUpperCase() + gender.slice(1) : null;
  const parts = [age != null ? String(age) : null, genderText].filter(
    (p): p is string => p !== null,
  );
  return parts.length ? parts.join(" / ") : undefined;
}

// The common fields every bill type shares, built once from the shared query
// row (§bill-document.ts core query) plus a caller-supplied hospital row.
export interface BillDocumentCore {
  locationId: string;
  hospitalName: string;
  hospitalTagline: string | null;
  hospitalAddress: string | null;
  hospitalPhone: string | null;
  footerNote: string | null;
  billNumber: string;
  dateText: string; // pre-formatted in the clinic timezone (SQL to_char), not reformatted here
  timeText: string;
  status: "final" | "pending_approval" | "void";
  subtotalPaise: string | number;
  discountPaise: string | number;
  totalPaise: string | number;
  paymentMode: string | null;
  patientCode: string;
  patientName: string;
  patientAge: number | null;
  patientGender: string | null;
  patientPhone: string | null;
  patientArea: string | null;
  cashierName: string;
}

// PURE mapper from already-fetched raw rows to the render model - no DB, no
// side effects, unit-tested directly (bill-document.test.ts). Kept separate
// from the DB-fetching resolver below so the shaping logic is testable without
// a database, matching this codebase's convention (repository.ts files query
// only; the testable logic lives in a pure function beside them).
export function buildConsultationDocument(
  core: BillDocumentCore,
  consultation: { doctorName: string; reason: string | null; validUntilText: string },
): ConsultationBillDocument {
  return {
    ...buildCommon(core),
    type: "consultation",
    doctorName: consultation.doctorName,
    reason: consultation.reason ?? undefined,
    validUntilText: consultation.validUntilText,
  };
}

export function buildProcedureDocument(
  core: BillDocumentCore,
  items: { description: string; quantity: number; unitPricePaise: string | number; lineTotalPaise: string | number }[],
): ProcedureBillDocument {
  return {
    ...buildCommon(core),
    type: "procedure",
    items: items.map((i) => ({
      desc: i.description,
      qty: String(i.quantity),
      unitText: formatRupees(i.unitPricePaise),
      lineText: formatRupees(i.lineTotalPaise),
    })),
  };
}

// Build the in-patient discharge render model (plan §6b). The room charge and
// advance are the admission's; the expenses are its itemised lines. The payable
// balance is (bill total − advance): shown as a plain amount when the patient
// still owes, or "Refund <amount>" when the advance exceeded the total - never
// silently dropped (PROJECT_OVERVIEW §In-Patient). All money pre-formatted here.
export function buildIpDocument(
  core: BillDocumentCore,
  ip: {
    admittedText: string;
    dischargedText: string | null;
    roomChargePaise: string | number;
    // Per-day breakdown, when the room was billed as rate × days - shown as
    // "5,600.00 (800.00/day x 7)" so the invoice reads honestly for a multi-day
    // stay. Null when the room was a flat figure (or unset).
    roomRatePaise?: string | number | null;
    roomDays?: number | null;
    advancePaise: string | number;
    expenses: { item: string; quantity: number; totalPaise: string | number }[];
  },
): IpBillDocument {
  const totalPaise = Number(core.totalPaise);
  const advancePaise = Number(ip.advancePaise);
  const balanceDue = Math.max(0, totalPaise - advancePaise);
  const refund = Math.max(0, advancePaise - totalPaise);
  const balanceText =
    refund > 0 ? `Refund ${formatRupees(refund)}` : formatRupees(balanceDue);
  const hasBreakdown = ip.roomRatePaise != null && ip.roomDays != null && Number(ip.roomChargePaise) > 0;
  const roomChargeText = hasBreakdown
    ? `${formatRupees(ip.roomChargePaise)} (${formatRupees(ip.roomRatePaise!)}/day x ${ip.roomDays})`
    : formatRupees(ip.roomChargePaise);
  return {
    ...buildCommon(core),
    type: "ip",
    admittedText: ip.admittedText,
    dischargedText: ip.dischargedText ?? undefined,
    roomChargeText,
    advanceText: formatRupees(ip.advancePaise),
    expenses: ip.expenses.map((e) => ({
      item: e.item,
      qty: String(e.quantity),
      amountText: formatRupees(e.totalPaise),
    })),
    balanceText,
  };
}

function buildCommon(core: BillDocumentCore): BillDocument {
  return {
    type: "consultation", // overwritten by the caller's spread; satisfies the base shape here
    locationId: core.locationId,
    hospital: {
      name: core.hospitalName,
      tagline: core.hospitalTagline ?? undefined,
      address: core.hospitalAddress ?? undefined,
      phone: core.hospitalPhone ?? undefined,
    },
    footerNote: core.footerNote ?? undefined,
    bill: {
      number: core.billNumber,
      dateText: core.dateText,
      timeText: core.timeText,
      statusLabel: STATUS_LABELS[core.status],
    },
    patient: {
      code: core.patientCode,
      name: core.patientName,
      ageGender: ageGenderText(core.patientAge, core.patientGender),
      phone: core.patientPhone ?? undefined,
      area: core.patientArea ?? undefined,
    },
    payment: {
      modeLabel: core.paymentMode ? PAYMENT_MODE_LABELS[core.paymentMode] : undefined,
      cashierName: core.cashierName,
    },
    totals: {
      subtotalText: formatRupees(core.subtotalPaise),
      discountText: Number(core.discountPaise) > 0 ? formatRupees(core.discountPaise) : undefined,
      totalText: formatRupees(core.totalPaise),
      totalInWords: amountInWords(core.totalPaise),
    },
  };
}

// The DB-backed resolver (getBillDocument(billId)) lives in
// ./bill-document-repository, which imports the builders above.
