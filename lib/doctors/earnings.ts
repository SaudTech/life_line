// PURE, Vitest-tested shaper for the DOCTOR EARNINGS sheet - "what does this doctor
// have coming for this window, across the whole counter, and how much of it has
// already been paid". No DB, no React: the repository reads rows, this turns them
// into the exact display model and computes every total (DEVELOPMENT_RULES §2/§26 -
// the UI never sums money). Integer paise throughout; formatting is the UI's job.
//
// WHY THIS SHEET EXISTS, and why it is not a slice of the day report.
// The daily report has exactly one subject axis: the staff member who took the money
// (bills.created_by). The doctor's cut appears there only as a sub-section INSIDE one
// desk user's day, so it inherits that scope - two OP desks each billing Dr Khalid
// produce two partial figures and no combined one, reachable only by an admin, only
// for a whole clinic day. That is the wrong document to hand a doctor at the counter.
//
// So the subject here is the DOCTOR, and `created_by` is not in the query at all -
// four consultations from one desk and nine from another are simply thirteen. Nobody
// adds two printed sheets together by hand, which is where the double-counting and
// the omissions come from.
//
// WHAT THE FIGURES MEAN. Every share is the amount FROZEN onto its bill when that
// bill was written (migration 0025), never re-priced from the doctor's rate today.
// A doctor whose rate changed inside the window therefore has more than one rate
// line, and the sheet says so rather than averaging them into a fiction.
//
// PAID vs PAYABLE. Since migration 0026 a consultation can be recorded as settled, so
// every figure here splits three ways: what the window is WORTH, what has ALREADY
// been paid (and by whom), and what is still PAYABLE. The headline total is the
// payable part - a sheet that totals work already paid for is how the same shift gets
// paid twice, which is the entire reason payouts are recorded.

import type { DoctorSession } from "./sessions";

// ── Raw inputs (what the repository reads) ────────────────────────────────────
// One (doctor × frozen rate) group inside the window. The rate is part of the key,
// not a property of the doctor, precisely because it can change mid-window.
export interface DoctorEarningRateRow {
  doctorId: string;
  doctorName: string;
  department: string | null;
  // The rate FROZEN on those bills. All three are null on legacy bills written
  // before migration 0025 - they carry an amount but never recorded a rate.
  shareType: string | null; // 'percentage' | 'flat' | null
  sharePercentage: number | null;
  shareFlatPaise: number | null;
  count: number; // consultation bills in this group
  collectedPaise: number; // what the counter took for them (fee − discount)
  sharePaise: number; // the doctor's summed frozen cut
}

// One settlement touching this window: how much of the window's work it covered, and
// who recorded it. A window can intersect several payouts (the morning was settled at
// 2pm, the evening at 8pm, and someone is now looking at the whole day), so this is a
// list per doctor, not a single flag.
export interface DoctorPayoutRow {
  doctorId: string;
  payoutId: string;
  paidByName: string;
  paidAtLabel: string; // clinic-clock, e.g. "6 Aug 2026, 2:04 pm"
  count: number; // consultations of THIS window covered by that payout
  paise: number; // their summed frozen share
}

// ── Shaped output (exactly what the UI renders) ───────────────────────────────
export interface DoctorEarningRateLine {
  key: string; // stable across renders; a doctor can have several rate lines
  rateLabel: string; // "40%" / "₹500.00 flat" / "rate not recorded"
  count: number;
  collectedPaise: number;
  sharePaise: number;
}

export interface DoctorEarningLine {
  doctorId: string;
  doctorName: string;
  department: string | null;
  count: number; // consultations for this doctor in the window
  collectedPaise: number; // what the hospital took for them
  sharePaise: number; // what the window is worth to the doctor, paid or not
  // One line per DISTINCT frozen rate. Length > 1 means the rate changed inside the
  // window; the UI surfaces that rather than hiding it behind a single figure.
  rates: DoctorEarningRateLine[];
  // Settlement (migration 0026).
  paidCount: number;
  paidPaise: number;
  payableCount: number; // count − paidCount
  payablePaise: number; // sharePaise − paidPaise
  payouts: DoctorPayoutRow[]; // who settled what, for the "already paid" callout
  isFullySettled: boolean; // every consultation in the window is already paid
}

export interface DoctorEarningsReport {
  doctors: DoctorEarningLine[];
  // Totals across every doctor shown, computed HERE so the UI renders and never sums.
  totalCount: number;
  totalCollectedPaise: number;
  totalSharePaise: number; // what the window is worth in total
  totalPaidPaise: number; // …of which already settled
  totalPayablePaise: number; // …leaving this to hand over
  totalPaidCount: number;
  totalPayableCount: number;
  // True when a doctor in the window was billed at more than one rate. Drives an
  // honest note on the sheet instead of a figure that quietly averages two deals.
  hasMixedRates: boolean;
  // True when ANY of this window's work has already been paid. Drives the warning
  // that has to be impossible to miss before someone pays it again.
  hasPaid: boolean;
  isEmpty: boolean;
}

// ── The action's contract ─────────────────────────────────────────────────────
// Declared here rather than beside the action because a "use server" module may
// only export async functions.

// What the report was run for, echoed back so the sheet's masthead states its own
// scope. A payout slip that does not say which periods it covers is how the same
// shift gets paid twice.
export interface EarningsMeta {
  hospitalName: string;
  generatedByName: string;
  // One entry per window covered, e.g. ["12:04 pm to 1:56 pm", "6:10 pm to 8:03 pm"].
  // A LIST, not a single from/to: two sittings paid together are not a range.
  windowLabels: string[];
  dayLabel: string; // "Thu 6 Aug 2026"
  endDayLabel: string | null; // set only for a multi-day range
  windowKind: "day" | "range" | "shift" | "sessions";
  dayIso: string;
  generatedAtLabel: string;
  doctorFilterCount: number; // 0 = every doctor at the location
  // How sessions were split for this run: the threshold applied, whether it was
  // derived from the doctor's own pace, and a line explaining the decision. A payout
  // tool must never split someone's day by a rule they cannot read.
  gapMinutes: number;
  gapSmart: boolean;
  gapReason: string;
}

// The window the caller wants, at one of three resolutions. `windows` (the session
// strip) wins over the shift fields, which win over the day/range - exactly one of
// them decides the sheet, so the masthead can always name what it covers.
export interface EarningsInput {
  day?: string;
  toDay?: string;
  startTime?: string; // 'HH:MM' clinic wall-clock
  endTime?: string; // 'HH:MM', EXCLUSIVE
  windows?: { from: string; to: string }[]; // explicit 'YYYY-MM-DD HH:MM' pairs
  doctorIds?: string[];
  // Omitted (or true) = smart detection from the doctor's own pace. A number is an
  // explicit manual override, which always wins.
  gapSmart?: boolean;
  gapMinutes?: number;
}

export interface DoctorEarningsResult {
  meta: EarningsMeta;
  report: DoctorEarningsReport;
  // The selected doctor's detected sittings for the WHOLE day - empty unless exactly
  // one doctor is selected and the report covers a single day.
  sessions: DoctorSession[];
}

// What a group with no recorded rate reads as. Legacy bills (pre-0025) carry an
// amount but never recorded the rate that produced it; printing "0%" beside a real
// payout would be a lie, so it says plainly that the rate is unknown.
export const NO_RATE_LABEL = "rate not recorded";

// Stable identity for one (doctor × frozen rate) group. The rate is part of the key
// because a doctor can be billed at more than one rate inside a window.
export function rateLineKey(r: {
  doctorId: string;
  shareType: string | null;
  sharePercentage: number | null;
  shareFlatPaise: number | null;
}): string {
  return `${r.doctorId}:${r.shareType ?? "none"}:${r.sharePercentage ?? ""}:${r.shareFlatPaise ?? ""}`;
}

// Shape the grouped rows into the display model. Pure: same input → same output, no
// clock, no DB.
//
// `rateLabels` maps a rate-line key to its worded rate, so the wording rule lives in
// exactly one place and this shaper does no formatting. A missing entry falls back to
// the honest "rate not recorded" rather than inventing one.
export function shapeDoctorEarnings(
  rows: DoctorEarningRateRow[],
  payouts: DoctorPayoutRow[] = [],
  rateLabels: Map<string, string> = new Map(),
): DoctorEarningsReport {
  const byDoctor = new Map<string, DoctorEarningLine>();

  for (const r of rows) {
    let line = byDoctor.get(r.doctorId);
    if (!line) {
      line = {
        doctorId: r.doctorId,
        doctorName: r.doctorName,
        department: r.department,
        count: 0,
        collectedPaise: 0,
        sharePaise: 0,
        rates: [],
        paidCount: 0,
        paidPaise: 0,
        payableCount: 0,
        payablePaise: 0,
        payouts: [],
        isFullySettled: false,
      };
      byDoctor.set(r.doctorId, line);
    }
    const key = rateLineKey(r);
    line.rates.push({
      key,
      rateLabel: rateLabels.get(key) ?? NO_RATE_LABEL,
      count: r.count,
      collectedPaise: r.collectedPaise,
      sharePaise: r.sharePaise,
    });
    line.count += r.count;
    line.collectedPaise += r.collectedPaise;
    line.sharePaise += r.sharePaise;
  }

  // Attach settlements. A payout for a doctor with no work in this window is simply
  // dropped - it belongs to a different window and saying otherwise would put a
  // stranger's payment on this slip.
  for (const p of payouts) {
    const line = byDoctor.get(p.doctorId);
    if (!line) continue;
    line.payouts.push(p);
    line.paidCount += p.count;
    line.paidPaise += p.paise;
  }

  const doctors = [...byDoctor.values()];
  for (const d of doctors) {
    // Payable is the REMAINDER, so it can never disagree with the two figures beside
    // it. Clamped at zero: a settlement can only cover bills inside this window, so
    // over-subtraction is impossible by construction - but a payout sheet must not be
    // able to print a negative "still owed" even if that ever stopped being true.
    d.payableCount = Math.max(0, d.count - d.paidCount);
    d.payablePaise = Math.max(0, d.sharePaise - d.paidPaise);
    d.isFullySettled = d.count > 0 && d.payableCount === 0;
  }

  return {
    doctors,
    totalCount: doctors.reduce((s, d) => s + d.count, 0),
    totalCollectedPaise: doctors.reduce((s, d) => s + d.collectedPaise, 0),
    totalSharePaise: doctors.reduce((s, d) => s + d.sharePaise, 0),
    totalPaidPaise: doctors.reduce((s, d) => s + d.paidPaise, 0),
    totalPayablePaise: doctors.reduce((s, d) => s + d.payablePaise, 0),
    totalPaidCount: doctors.reduce((s, d) => s + d.paidCount, 0),
    totalPayableCount: doctors.reduce((s, d) => s + d.payableCount, 0),
    hasMixedRates: doctors.some((d) => d.rates.length > 1),
    hasPaid: doctors.some((d) => d.paidCount > 0),
    isEmpty: doctors.length === 0,
  };
}
