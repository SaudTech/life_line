// PURE, Vitest-tested shaper for the self-scoped daily report ("what I did today",
// plan §4). No DB, no React, no server-only imports - it turns the raw grouped rows
// the repository reads (audit_log counts + bills/admissions money groups) into the
// exact display model the UI renders, and computes the GRAND TOTAL (excluding
// voids). The UI only renders what this returns; it never sums money itself
// (DEVELOPMENT_RULES §2/§26). Money is integer paise throughout - formatting to
// rupees is the UI's job (formatPaise), never here.

import { activityMeta, type Tone } from "@/lib/activity/actions";
import { PAYMENT_MODES, type PaymentModeValue } from "@/lib/consultations/schema";

// ── Fixed display orders (muscle memory, dev-rules §5: nothing moves) ──────────
// Bill types, in the order they read on the sheet.
export const BILL_TYPES = ["consultation", "procedure", "ip"] as const;
export type BillTypeValue = (typeof BILL_TYPES)[number];

const TYPE_LABELS: Record<BillTypeValue, string> = {
  consultation: "Consultation",
  procedure: "Procedure",
  ip: "In-patient",
};

const MODE_LABELS: Record<PaymentModeValue, string> = {
  cash: "Cash",
  card: "Card",
  upi: "UPI",
  other: "Other",
};

// The curated, unambiguous activity tags shown in the "what I did" summary, in
// display order. bill.finalize / receipt.printed are deliberately omitted: a
// finalize covers consultation, procedure AND discharge bills alike, so its count
// would double what the per-type money section already shows. Labels + tone come
// from the ONE canonical registry (lib/activity/actions.ts) - never re-labelled here.
const REPORT_ACTIONS = [
  "patient.create",
  "consultation.create",
  "consultation.revisit",
  "consultation.revisit_paid",
  "admission.admit",
  "admission.discharge",
  "discount.approve",
  "bill.reissue",
  "bill.void",
] as const;

// ── Raw inputs (what the repository hands us) ──────────────────────────────────
// A grouped money row: a count of bills/admissions and their summed total, keyed
// by type / payment mode. Paise are integers already (the repository Number()s the
// BIGINT sums; a day's total is far below Number.MAX_SAFE_INTEGER).
export interface MoneyGroupRow {
  key: string;
  count: number;
  totalPaise: number;
}

// A grouped audit-count row, keyed by the action tag.
export interface ActivityCountRow {
  action: string;
  count: number;
}

// One doctor's cut of the day's consultation collections, summed from the share
// SNAPSHOTTED onto each bill when it was written (migration 0025). The rate fields
// are the rate that was frozen with it, so the UI can say how the figure was
// arrived at AT THE TIME - not what the doctor happens to be on now. A doctor whose
// rate changed mid-window produces one row per rate, which is the honest reading.
//
// All three rate fields are nullable: a legacy consultation bill written before
// 0025 has an amount but never recorded a rate, and "no rate" is a different
// statement from "0%".
export interface DoctorShareRow {
  doctorId: string;
  doctorName: string;
  shareType: string | null; // 'percentage' | 'flat' | null (no rate recorded)
  sharePercentage: number | null; // whole percent (set when shareType='percentage')
  shareFlatPaise: number | null; // integer paise (set when shareType='flat')
  count: number; // consultation bills for this doctor in scope
  sharePaise: number; // the doctor's summed share, integer paise
}

// Cash handed to ONE doctor on this clinic day, from the payout records (migration
// 0026). This is the settlement half of the doctor economics, and it is a different
// quantity from DoctorShareRow above in every way that matters:
//
//   DoctorShareRow  - what the day's consultations EARNED the doctor. Accrual. The
//                     money is still in the drawer. Informational; changes nothing.
//   DoctorPayoutRow - what was PHYSICALLY HANDED OVER today. Cash. It left the
//                     drawer, so it must come out of money-in or the till is short.
//
// Reckoned on WHEN IT WAS PAID (doctor_payouts.paid_at), never on which period it
// covered: a Monday shift settled on Wednesday is Wednesday's cash movement, and
// Wednesday is the drawer that will be short. Attributed to WHO PAID IT
// (doctor_payouts.paid_by) for the same reason - that is whose till it came out of.
export interface DoctorPayoutRow {
  doctorId: string;
  doctorName: string;
  count: number; // consultations the payout covered
  paise: number; // cash handed over, integer paise
}

export interface MoneyRaw {
  // My non-void bills (created_by = me, in the clinic-day range), grouped.
  billsByType: MoneyGroupRow[];
  billsByMode: MoneyGroupRow[];
  // Total discount value on my non-void bills.
  discountOnMyBillsPaise: number;
  // Discounts I APPROVED (discount_approved_by = me) - a supervisor sees these
  // even when they didn't create the bill, without claiming its revenue (§7).
  discountsApproved: { count: number; totalPaise: number };
  // Bills I VOIDED today (voided_by = me, voided in range). A void is not revenue -
  // shown separately, EXCLUDED from the collected total (§3/§7).
  voids: { count: number; totalPaise: number };
  // The doctor's cut of the scoped consultation bills, grouped per doctor. A
  // legacy consultation bill with no consultation link contributes NO row here
  // (its money stays wholly with the hospital) - the split still ties out because
  // the hospital share is reckoned as collections − shares, below.
  doctorShares: DoctorShareRow[];
  // Admission deposits I took today (admissions.created_by = me), by payment mode.
  advancesByMode: MoneyGroupRow[];
  // Cash I handed BACK today: a discharge whose advance exceeded the final total
  // (§In-Patient - a refund is handled explicitly, never ignored). Already netted out
  // of billsBy*, so this is the visible record of the outflow, not a second deduction.
  refunds: { count: number; totalPaise: number };
  // Cash I handed to DOCTORS today, one row per doctor. Unlike refunds this is NOT
  // netted out anywhere else - nothing in the bills table knows a payout happened - so
  // the shaper subtracts it from money-in exactly once, and this is the only place it
  // is deducted.
  doctorPayouts: DoctorPayoutRow[];
}

// ── Document upload compliance (raw) ───────────────────────────────────────────
// Every consultation and IP discharge is supposed to get its scans / case-study
// documents uploaded (patient_documents). This block is how the day report says
// "you still owe uploads": for the scoped subject and day, how many records of
// each kind they produced, and WHICH ones still have zero live documents. Checked
// live at report time - a document uploaded (or admin-deleted) after the day
// moves a record out of (or back into) the pending list, which is the honest
// reading of "pending work".

// One record still awaiting its documents - identified the way the staff see it
// on the OPD/IPD lists (record #) plus the patient, so it can be found and
// finished rather than hunted for.
export interface PendingDocumentRow {
  recordId: string; // consultation id (opd) / admission id (ipd)
  patientName: string;
  patientCode: string;
}

export interface DocumentComplianceRaw {
  // total: consultations the subject billed in the range (final bills).
  // pending: the subset with no live documents, oldest first.
  opd: { total: number; pending: PendingDocumentRow[] };
  // Same, for admissions the subject DISCHARGED in the range (final ip bills).
  ipd: { total: number; pending: PendingDocumentRow[] };
}

export function emptyDocumentComplianceRaw(): DocumentComplianceRaw {
  return { opd: { total: 0, pending: [] }, ipd: { total: 0, pending: [] } };
}

// ── Shaped output (exactly what the UI renders) ────────────────────────────────
export interface ReportLine {
  key: string;
  label: string;
  count: number;
  totalPaise: number;
}

export interface ActivityLine {
  action: string;
  label: string;
  tone: Tone;
  count: number;
}

export interface DailyReport {
  // A. What I did - only the tags that actually happened, in curated order.
  activity: ActivityLine[];
  activityTotal: number;
  // B. What I collected - every type/mode present with a zero-filled row so the
  // layout is fixed. `collected*` is the reconciliation total (excludes voids).
  byType: ReportLine[];
  byMode: ReportLine[];
  collectedTotalPaise: number;
  collectedCount: number;
  discountOnMyBillsPaise: number;
  discountsApproved: { count: number; totalPaise: number };
  voids: { count: number; totalPaise: number };
  // The consultation split: collections − doctor shares = hospital share. All
  // three computed HERE (the UI never sums money, §2/§26). INFORMATIONAL - the
  // doctor's cut is still physically in the drawer (paid out to the doctor
  // later, not at the counter), so none of this touches moneyInTotalPaise.
  consultationCollected: { count: number; totalPaise: number };
  doctorShares: DoctorShareRow[];
  doctorShareTotalPaise: number;
  // What the hospital keeps of the consultation collections. Never negative by
  // construction: the share rule clamps each bill's share to what it collected
  // (lib/doctors/share.ts), and unlinked legacy bills contribute collections
  // with no share.
  hospitalShareTotalPaise: number;
  advancesByMode: ReportLine[];
  advancesTotalPaise: number;
  advancesCount: number;
  refunds: { count: number; totalPaise: number };
  // Doctors paid today, per doctor, plus the totals. A payout sheet that says only
  // "-₹5,564.00" is unauditable at the counter: the first question when the till is
  // short is "which doctor, and for how many consultations", so the sheet answers it
  // by name (§4, a movement of cash is never an unexplained number).
  doctorPayouts: DoctorPayoutRow[];
  doctorPayoutTotalPaise: number;
  doctorPayoutCount: number; // consultations covered, across all payouts
  // The ONE number that has to match the drawer at close:
  //   bills collected + advances taken − refunds paid out − doctors paid
  // The parts are separate FIELDS, not a pre-netted lump, so the sheet can show a
  // reader the arithmetic: a ₹20,000 advance in, a ₹2,000 refund back out, ₹5,564
  // handed to Dr Anita Rao.
  //
  // WHY THE DOCTOR PAYOUT IS HERE AND THE DOCTOR SHARE IS NOT. They are two different
  // quantities and only one is cash. `doctorShareTotalPaise` is what the day's
  // consultations EARNED the doctors - it is still sitting in the drawer, so
  // subtracting it would make the sheet ask for less money than is physically there.
  // A payout is the doctor walking away with notes in hand. Until migration 0026 the
  // second thing was not recorded at all, so this sheet told the counter to expect cash
  // that had already left.
  //
  // This is deliberately NOT mirrored onto the admin dashboard. That screen measures
  // REVENUE - what the hospital earned over a range - and a payout is a distribution of
  // revenue already earned, not negative revenue. It already deducts the doctors' cut
  // on an accrual basis (getDoctorShareTotal). Only this figure has to match physical
  // cash, so only this figure nets the payout out.
  moneyInTotalPaise: number;
  // Document upload compliance: of the records this subject produced on the day,
  // how many have their scans uploaded and exactly which are still pending. Not
  // money - operational pending WORK, and the report is where it gets called out.
  documents: {
    opd: DocumentComplianceLine;
    ipd: DocumentComplianceLine;
    pendingTotal: number; // opd pending + ipd pending, for the one-line callout
  };
  // True when there is genuinely nothing to show - drives an honest empty state
  // instead of a wall of zeros or a crash (§7).
  isEmpty: boolean;
}

export interface DocumentComplianceLine {
  total: number; // records of this kind the subject produced in the range
  withDocuments: number; // total − pending, clamped at 0 (never negative)
  pending: PendingDocumentRow[]; // the exact records still owing uploads
}

// Index grouped rows by key for O(1) zero-filled lookup.
function byKey(rows: MoneyGroupRow[]): Map<string, MoneyGroupRow> {
  const m = new Map<string, MoneyGroupRow>();
  for (const r of rows) m.set(r.key, r);
  return m;
}

// Lay out a fixed set of keys as report lines, defaulting missing keys to zero.
function layout<K extends string>(
  keys: readonly K[],
  labels: Record<K, string>,
  rows: MoneyGroupRow[],
): ReportLine[] {
  const found = byKey(rows);
  return keys.map((key) => {
    const r = found.get(key);
    return { key, label: labels[key], count: r?.count ?? 0, totalPaise: r?.totalPaise ?? 0 };
  });
}

// Shape the raw grouped rows into the display model. Pure: same input → same
// output, no clock, no DB. The grand total is Σ of the by-mode (non-void) lines -
// voids are held in their own field and NEVER added in, which is the "excluded
// from collected totals" guarantee (§7).
export function shapeDailyReport(
  activityCounts: ActivityCountRow[],
  money: MoneyRaw,
  // Optional so callers that don't surface compliance (the pdfme End-Day PDF)
  // keep working unchanged - they simply get an all-zero block.
  documents: DocumentComplianceRaw = emptyDocumentComplianceRaw(),
): DailyReport {
  const activityByAction = new Map<string, number>();
  for (const c of activityCounts) activityByAction.set(c.action, c.count);

  const activity: ActivityLine[] = REPORT_ACTIONS.flatMap((action) => {
    const count = activityByAction.get(action) ?? 0;
    if (count <= 0) return [];
    const { label, tone } = activityMeta(action);
    return [{ action, label, tone, count }];
  });
  const activityTotal = activity.reduce((sum, a) => sum + a.count, 0);

  const byType = layout(BILL_TYPES, TYPE_LABELS, money.billsByType);
  const byMode = layout(PAYMENT_MODES, MODE_LABELS, money.billsByMode);
  const advancesByMode = layout(PAYMENT_MODES, MODE_LABELS, money.advancesByMode);

  const collectedTotalPaise = byMode.reduce((sum, l) => sum + l.totalPaise, 0);
  const collectedCount = byMode.reduce((sum, l) => sum + l.count, 0);

  // The consultation split. Its base is the by-type consultation line - a lookup
  // of an already-summed figure, so the split's parts always reconcile against
  // the Collections section on the same sheet.
  const consultationLine = byType.find((l) => l.key === "consultation");
  const consultationCollected = {
    count: consultationLine?.count ?? 0,
    totalPaise: consultationLine?.totalPaise ?? 0,
  };
  const doctorShareTotalPaise = money.doctorShares.reduce((sum, d) => sum + d.sharePaise, 0);
  const hospitalShareTotalPaise = consultationCollected.totalPaise - doctorShareTotalPaise;
  const advancesTotalPaise = advancesByMode.reduce((sum, l) => sum + l.totalPaise, 0);
  const advancesCount = advancesByMode.reduce((sum, l) => sum + l.count, 0);
  const doctorPayoutTotalPaise = money.doctorPayouts.reduce((sum, p) => sum + p.paise, 0);
  const doctorPayoutCount = money.doctorPayouts.reduce((sum, p) => sum + p.count, 0);

  // withDocuments as a REMAINDER of the two figures the repository reads, clamped
  // so a count race (a record billed between the total and pending queries) can
  // never print "-1 with documents" on the sheet.
  const shapeCompliance = (c: {
    total: number;
    pending: PendingDocumentRow[];
  }): DocumentComplianceLine => ({
    total: c.total,
    withDocuments: Math.max(0, c.total - c.pending.length),
    pending: c.pending,
  });
  const opdDocs = shapeCompliance(documents.opd);
  const ipdDocs = shapeCompliance(documents.ipd);

  const isEmpty =
    activity.length === 0 &&
    collectedCount === 0 &&
    advancesCount === 0 &&
    money.voids.count === 0 &&
    money.refunds.count === 0 &&
    // A day whose only event was paying a doctor is NOT an empty day - real cash left
    // the drawer and the sheet has to account for it.
    money.doctorPayouts.length === 0 &&
    money.discountsApproved.count === 0;

  return {
    activity,
    activityTotal,
    byType,
    byMode,
    collectedTotalPaise,
    collectedCount,
    discountOnMyBillsPaise: money.discountOnMyBillsPaise,
    discountsApproved: money.discountsApproved,
    voids: money.voids,
    consultationCollected,
    doctorShares: money.doctorShares,
    doctorShareTotalPaise,
    hospitalShareTotalPaise,
    advancesByMode,
    advancesTotalPaise,
    advancesCount,
    refunds: money.refunds,
    doctorPayouts: money.doctorPayouts,
    doctorPayoutTotalPaise,
    doctorPayoutCount,
    // Taken in, less handed back. The refund is subtracted exactly ONCE here, because
    // the by-type/by-mode lines above are now gross of refunds (the repository sums
    // billCollectedSql). Do not net it in there as well, or a refunded day is short by
    // twice the refund. The payout is subtracted once for the opposite reason: nothing
    // else in the money path knows it happened at all.
    moneyInTotalPaise:
      collectedTotalPaise +
      advancesTotalPaise -
      money.refunds.totalPaise -
      doctorPayoutTotalPaise,
    documents: {
      opd: opdDocs,
      ipd: ipdDocs,
      pendingTotal: opdDocs.pending.length + ipdDocs.pending.length,
    },
    isEmpty,
  };
}

// An all-zero MoneyRaw - handy for callers/tests representing "nothing on this day".
export function emptyMoneyRaw(): MoneyRaw {
  return {
    billsByType: [],
    billsByMode: [],
    discountOnMyBillsPaise: 0,
    discountsApproved: { count: 0, totalPaise: 0 },
    voids: { count: 0, totalPaise: 0 },
    doctorShares: [],
    advancesByMode: [],
    refunds: { count: 0, totalPaise: 0 },
    doctorPayouts: [],
  };
}
