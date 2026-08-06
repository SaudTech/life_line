// ONE definition of "money in" - what the hospital actually collected.
//
// This module exists because "money in" used to be defined TWICE, in two screens,
// and the two definitions disagreed (the admin dashboard summed bills + advances and
// double-counted every advance; the daily report kept advances separate and
// over-counted every IP bill by the advance). DEVELOPMENT_RULES §2: one source of
// truth per rule. That rule is here, and nowhere else.
//
// PURE and DB-free: no pool, no React. The SQL helpers below are string fragments,
// not queries - they let the repositories share one expression instead of hand-writing
// it, and `billMoneyInPaise` is the same rule in JS so it can be unit-tested without a
// database (lib/money-in.test.ts). If you change one, change the other, and the tests
// will tell you if they drift.
//
// THE RULE. Cash moves at two moments in a stay, and money-in is reckoned on the
// clinic day each movement happened:
//
//   at admit     +advance_paid_paise            (admissions.admitted_at)
//   at discharge +balance_due_paise             (bills.created_at, type='ip')
//                −refund_paise                  (bills.created_at, type='ip')
//   OP bill      +total_paise                   (bills.created_at, type≠'ip')
//
// An IP bill's `total_paise` is the GROSS bill (room + expenses − discount) and still
// contains the advance, so it must NEVER be summed as money-in - that is precisely the
// double-count. Use these helpers; do not write `sum(total_paise)` for revenue again.
//
// WHY TWO HELPERS. The four movements above are the truth, and a sheet someone
// reconciles a drawer against has to show them AS movements. Folding the refund into
// the bill's line produced a row reading "In-patient · 1 bill · −₹2,000" for a stay that
// was billed ₹18,000 and took a ₹20,000 advance: arithmetically right, and unreadable.
// So `billCollectedPaise` is what was TAKEN and the refund is a separate line that is
// SUBTRACTED once; `billMoneyInPaise` is the net of the two, for callers that only need
// the day's number. Both totals agree by construction - net = taken − given back.
//
// Only status='final' is money. A 'pending_approval' bill isn't settled and a 'void'
// isn't revenue. Both are excluded by the callers' WHERE clause, not here.

export const CLINIC_TZ = "Asia/Kolkata";

// Bill types whose total is settled in full the moment the bill is issued.
export type BillType = "consultation" | "procedure" | "ip";

// What the counter COLLECTED for one finalized bill, in integer paise. Never negative:
// this is money taken, and a refund is money given back - a different movement, counted
// on its own line (see billMoneyInPaise below).
//
// An IP bill collects only its BALANCE DUE. Its `total_paise` is the gross stay (room +
// expenses − discount) and still contains the advance taken at admit, so summing totals
// would count that advance twice.
export function billCollectedPaise(bill: {
  type: BillType;
  totalPaise: number;
  balanceDuePaise: number;
}): number {
  return bill.type === "ip" ? bill.balanceDuePaise : bill.totalPaise;
}

// The SQL form of billCollectedPaise, for summing over the `bills` table. `alias` is the
// table alias in the caller's query ("" for an unaliased FROM bills).
export function billCollectedSql(alias = ""): string {
  const p = alias ? `${alias}.` : "";
  return `CASE WHEN ${p}type = 'ip'
               THEN ${p}balance_due_paise
               ELSE ${p}total_paise
          END`;
}

// The NET money-in of one finalized bill: what it collected, less any cash handed back
// at the same moment. Can be negative - a discharge that refunds more than its balance
// is cash leaving the drawer, and must pull the day's total down (§4).
//
// Defined in terms of billCollectedPaise so the two can never drift: net = taken − given
// back. Callers that show a person WHERE the money went (the report sheet) want the two
// halves separately; callers that only need the day's figure (the dashboard) want this.
export function billMoneyInPaise(bill: {
  type: BillType;
  totalPaise: number;
  balanceDuePaise: number;
  refundPaise: number;
}): number {
  return billCollectedPaise(bill) - bill.refundPaise;
}

// The SQL form of billMoneyInPaise. Same relationship: collected, less the refund.
export function billMoneyInSql(alias = ""): string {
  const p = alias ? `${alias}.` : "";
  return `(${billCollectedSql(alias)} - ${p}refund_paise)`;
}

// The half-open clinic-day range predicate for a timestamptz column, using the given
// 1-based parameter indices for the inclusive from/to ISO days:
//   [ from 00:00 IST , (to + 1) 00:00 IST )
// Built with AT TIME ZONE so the boundary is correct regardless of the DB session
// timezone, and index-friendly: the filtered column is never wrapped in a per-row
// function, so the (location_id, status, created_at) index is usable (migration 0019).
//
// Was duplicated verbatim in lib/dashboard/repository.ts and lib/reports/repository.ts.
// Now defined once, so both screens can never reckon a clinic day differently.
export function clinicRange(col: string, fromParam: number, toParam: number): string {
  return `${col} >= ($${fromParam}::date)::timestamp AT TIME ZONE '${CLINIC_TZ}'
      AND ${col} <  (($${toParam}::date + 1))::timestamp AT TIME ZONE '${CLINIC_TZ}'`;
}

// A predicate matching a timestamptz column against ONE OR MORE half-open clinic
// wall-clock windows ('YYYY-MM-DD HH:MM'), OR-ed together:
//   [ from₁ IST , to₁ IST )  OR  [ from₂ IST , to₂ IST )  OR  …
// Parameters are read in pairs starting at `firstParam`: (from₁, to₁, from₂, to₂, …).
//
// Same AT TIME ZONE discipline and same index-friendly shape as clinicRange - the
// filtered column is never wrapped in a per-row function, so each disjunct can still
// use the (location_id, status, created_at) index - but with time of day instead of
// whole days.
//
// WHY THIS EXISTS ALONGSIDE clinicRange. clinicRange answers "which clinic DAY",
// the right axis for a day sheet reconciled at close. It cannot express a doctor's
// 12:00-14:00 shift, because a date has no time of day. Doctors are paid per shift,
// so the doctor-earnings query is built on this instead; a whole day is simply the
// single window 00:00 → next 00:00, and the two then agree exactly.
//
// WHY SEVERAL WINDOWS. A doctor works 12:00-14:00 and again 18:00-20:00 and is paid
// for both at once. That is not a range - the afternoon between them is somebody
// else's work - so it cannot be expressed as one [from, to). OR-ing the windows is
// safe against double counting: a row matching two disjuncts is still one row.
export function clinicInstantWindows(col: string, firstParam: number, count: number): string {
  if (count < 1) throw new Error(`clinicInstantWindows needs at least one window, got: ${count}`);
  const parts: string[] = [];
  for (let i = 0; i < count; i++) {
    const f = firstParam + i * 2;
    const t = f + 1;
    parts.push(
      `(${col} >= ($${f}::timestamp AT TIME ZONE '${CLINIC_TZ}')
        AND ${col} <  ($${t}::timestamp AT TIME ZONE '${CLINIC_TZ}'))`,
    );
  }
  return `(${parts.join("\n        OR ")})`;
}

// Read a BIGINT sum pg returns as text into an integer. A location's daily/monthly
// totals are far below Number.MAX_SAFE_INTEGER, so this stays exact - it only bridges
// pg's text BIGINT into JS, and is never a float in the money path (§4).
export function toPaise(v: string | null): number {
  return v == null ? 0 : Number(v);
}
