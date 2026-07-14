// PURE, Vitest-tested helpers for the admin financial dashboard (the four cards
// on the admin home). No DB, no React, no server-only imports - it turns the raw
// grouped rows the repository reads into the numbers the cards render, and does
// the only real "math" on this screen: the day-over-day / month-over-month
// percentage change and the zero-filled sparkline series.
//
// Money is integer paise throughout (DEVELOPMENT_RULES §1) - a single location's
// daily/monthly totals are far below Number.MAX_SAFE_INTEGER, so the sums stay
// exact. Formatting to rupees is the UI's job (formatPaise), never here.

import { addDays } from "@/lib/date-range";

// One day's money-in, keyed by clinic day 'YYYY-MM-DD'. The repository returns a
// row only for days that saw money; the series builders below zero-fill the gaps
// so a card always renders a fixed-length series (no jagged sparkline).
export interface DayPoint {
  day: string; // clinic day, 'YYYY-MM-DD'
  paise: number;
}

// The direction of a change, so the UI can tint it (green up / red down / grey
// flat) - colour is for status only (§5).
export type ChangeDirection = "up" | "down" | "flat";

export interface ChangeResult {
  // Percentage change vs the previous period, rounded to a whole number. NULL when
  // there's no baseline to divide by (previous = 0): "+100%" off a zero base is
  // meaningless, so the UI shows a "new" dash instead of a fake percentage.
  pct: number | null;
  direction: ChangeDirection;
}

// Day-over-day / month-over-month change. Integer-only division on paise; the
// result is a display percentage, never fed back into a money calculation.
export function changePct(current: number, previous: number): ChangeResult {
  if (previous === 0) {
    // No baseline. Direction still reflects reality: money today off nothing
    // yesterday is "up", nothing off nothing is "flat".
    return { pct: null, direction: current > 0 ? "up" : "flat" };
  }
  const raw = ((current - previous) / previous) * 100;
  const pct = Math.round(raw);
  const direction: ChangeDirection = pct > 0 ? "up" : pct < 0 ? "down" : "flat";
  return { pct, direction };
}

// Every inclusive clinic day from `from` to `to`, in order. Used to zero-fill a
// sparse money series into a fixed-length one. `from` after `to` yields [].
export function enumerateDays(from: string, to: string): string[] {
  const days: string[] = [];
  let d = from;
  // ISO day strings compare lexicographically in calendar order, so this is a
  // safe loop bound with no Date math per step.
  while (d <= to) {
    days.push(d);
    d = addDays(d, 1);
  }
  return days;
}

// Zero-filled paise series across [from, to], in day order - the sparkline's Y
// values. Rows outside the range are ignored; missing days become 0.
export function seriesFromRows(rows: DayPoint[], from: string, to: string): number[] {
  const byDay = new Map(rows.map((r) => [r.day, r.paise]));
  return enumerateDays(from, to).map((day) => byDay.get(day) ?? 0);
}

// Sum a paise series (or any paise list). Kept here so no card sums money inline.
export function sumPaise(values: number[]): number {
  return values.reduce((acc, v) => acc + v, 0);
}

// The first day of the clinic month containing `iso` ('YYYY-MM-01').
export function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

// Month-to-date range: the 1st of this month through `today`, inclusive.
export function monthToDateRange(today: string): { from: string; to: string } {
  return { from: monthStart(today), to: today };
}

// The comparable window in the PREVIOUS month: the 1st through the same
// day-of-month as today, so a mid-month MTD compares against an equal-length
// slice of last month (not the whole month). Clamped to the previous month's
// last day, so e.g. the 31st compared into February stops at the 28th/29th
// rather than spilling into March.
export function prevMonthComparableRange(today: string): { from: string; to: string } {
  const prevMonthLastDay = addDays(monthStart(today), -1); // last day of prev month
  const from = monthStart(prevMonthLastDay);
  const dayOfMonth = Number(today.slice(8, 10));
  const sameLengthEnd = addDays(from, dayOfMonth - 1);
  // min of two ISO days is a plain string compare (calendar order).
  const to = sameLengthEnd < prevMonthLastDay ? sameLengthEnd : prevMonthLastDay;
  return { from, to };
}

// ── Department split ───────────────────────────────────────────────────────────
// A raw department revenue row from the repository (consultation + procedure
// revenue grouped by the consulting doctor's department; a null department is
// already coalesced to "Unassigned" in SQL).
export interface DepartmentRow {
  department: string;
  paise: number;
}

// One rendered department line: its share of the day's revenue as a whole-number
// percentage (for a bar width) alongside the paise.
export interface DepartmentSlice {
  department: string;
  paise: number;
  pct: number; // share of the total, 0-100, rounded
}

// The label for the single bucket that holds ALL in-patient revenue (discharge
// bills + admission advances). IP has no per-department attribution in the data
// model, so it's shown as one line rather than split by specialty.
export const IN_PATIENT_LABEL = "In-Patient";

// Merge the consultation/procedure department rows with the IP bucket into one
// sorted, percentage-annotated list for the "Revenue by department" card. The IP
// bucket is appended as its own line (only when it holds money), everything is
// sorted by revenue descending, and a zero-total day yields an empty list (the
// card shows an empty state rather than a row of 0%).
export function shapeDepartmentSplit(
  rows: DepartmentRow[],
  inPatientPaise: number,
): DepartmentSlice[] {
  const merged: DepartmentRow[] = [...rows.filter((r) => r.paise > 0)];
  if (inPatientPaise > 0) {
    merged.push({ department: IN_PATIENT_LABEL, paise: inPatientPaise });
  }
  const total = sumPaise(merged.map((r) => r.paise));
  if (total === 0) return [];
  return merged
    .sort((a, b) => b.paise - a.paise)
    .map((r) => ({
      department: r.department,
      paise: r.paise,
      pct: Math.round((r.paise / total) * 100),
    }));
}
