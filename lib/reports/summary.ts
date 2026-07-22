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
  // Admission deposits I took today (admissions.created_by = me), by payment mode.
  advancesByMode: MoneyGroupRow[];
  // Cash I handed BACK today: a discharge whose advance exceeded the final total
  // (§In-Patient - a refund is handled explicitly, never ignored). Already netted out
  // of billsBy*, so this is the visible record of the outflow, not a second deduction.
  refunds: { count: number; totalPaise: number };
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
  advancesByMode: ReportLine[];
  advancesTotalPaise: number;
  advancesCount: number;
  refunds: { count: number; totalPaise: number };
  // The ONE number that has to match the drawer at close:
  //   bills collected + advances taken − refunds paid out
  // The three parts are separate FIELDS, not a pre-netted lump, so the sheet can show a
  // reader the arithmetic: a ₹20,000 advance in, a ₹2,000 refund back out. This is the
  // same quantity the admin dashboard sums for the same day (lib/money-in.ts, which
  // nets the refund into the bill instead) - if the two ever disagree, one of them is
  // lying about the hospital's money.
  moneyInTotalPaise: number;
  // True when there is genuinely nothing to show - drives an honest empty state
  // instead of a wall of zeros or a crash (§7).
  isEmpty: boolean;
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
  const advancesTotalPaise = advancesByMode.reduce((sum, l) => sum + l.totalPaise, 0);
  const advancesCount = advancesByMode.reduce((sum, l) => sum + l.count, 0);

  const isEmpty =
    activity.length === 0 &&
    collectedCount === 0 &&
    advancesCount === 0 &&
    money.voids.count === 0 &&
    money.refunds.count === 0 &&
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
    advancesByMode,
    advancesTotalPaise,
    advancesCount,
    refunds: money.refunds,
    // Taken in, less handed back. The refund is subtracted exactly ONCE here, because
    // the by-type/by-mode lines above are now gross of refunds (the repository sums
    // billCollectedSql). Do not net it in there as well, or a refunded day is short by
    // twice the refund.
    moneyInTotalPaise: collectedTotalPaise + advancesTotalPaise - money.refunds.totalPaise,
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
    advancesByMode: [],
    refunds: { count: 0, totalPaise: 0 },
  };
}
