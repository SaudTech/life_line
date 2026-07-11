// Pure, tested billing rules for consultations (DEVELOPMENT_RULES §1/§4 - one
// source of truth per rule, no DB, no side effects). The UI never re-implements
// these for a "preview"; it asks the server, which asks these functions.
//
// Domain (PROJECT_OVERVIEW §Consultation):
//   • Each DOCTOR has a fee and a validity period in days.
//   • Creating a consultation charges that fee and sets
//       valid_until = today + doctor.revisit_validity_days.
//   • A return visit to the SAME doctor on or before valid_until is FREE and
//     recorded under the same consultation (a "revisit").
//   • A visit to a DIFFERENT doctor is always a new consultation and fee.
//
// Money is NOT computed here - the fee charged is simply the doctor's fee_paise,
// copied at creation. These rules are purely about DATES and doctor identity.
//
// Dates are handled as CALENDAR DAYS in ISO 'YYYY-MM-DD' form. A DATE column has
// no time-of-day, and comparing JS Date objects across time zones invites
// off-by-one bugs at midnight - ISO day strings compare correctly with plain `<=`
// (lexicographic order matches chronological order for zero-padded ISO dates) and
// are timezone-proof and deterministic.

export type IsoDay = string; // 'YYYY-MM-DD'

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function assertIsoDay(day: string): void {
  if (!ISO_DAY.test(day)) {
    throw new Error(`Expected an ISO day 'YYYY-MM-DD', got: ${JSON.stringify(day)}`);
  }
}

// Format a Date's UTC calendar day as 'YYYY-MM-DD'. Used with Date.UTC arithmetic
// below so the result never shifts by a day due to the local time zone.
function toIsoDay(date: Date): IsoDay {
  const y = date.getUTCFullYear().toString().padStart(4, "0");
  const m = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const d = date.getUTCDate().toString().padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Add a whole number of days to a calendar day. Uses UTC math so month/year
// boundaries and DST are handled correctly and without local-zone drift.
export function addDays(day: IsoDay, days: number): IsoDay {
  assertIsoDay(day);
  if (!Number.isInteger(days)) {
    throw new Error(`Expected an integer number of days, got: ${days}`);
  }
  const [y, m, d] = day.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d) + days * 86_400_000;
  return toIsoDay(new Date(ms));
}

// The last day a consultation covers: startDay + the doctor's validity days.
// validityDays === 0 means the consultation only covers its own day (valid_until
// === startDay), so a same-day revisit is free but the next day is not.
export function computeValidUntil(startDay: IsoDay, validityDays: number): IsoDay {
  if (!Number.isInteger(validityDays) || validityDays < 0) {
    throw new Error(`validityDays must be a non-negative integer, got: ${validityDays}`);
  }
  return addDays(startDay, validityDays);
}

// A consultation is valid THROUGH its valid_until day, inclusive - a visit "on or
// before valid_until" is still covered (PROJECT_OVERVIEW §Consultation).
export function isConsultationValid(validUntil: IsoDay, on: IsoDay): boolean {
  assertIsoDay(validUntil);
  assertIsoDay(on);
  return on <= validUntil;
}

// A visit is a FREE revisit iff it is the SAME doctor AND that consultation is
// still valid on the visit day. A different doctor is always a new, paid
// consultation - even if some other consultation is still open.
export function isRevisitFree(
  consultation: { doctorId: string; validUntil: IsoDay },
  visit: { doctorId: string; on: IsoDay },
): boolean {
  return (
    visit.doctorId === consultation.doctorId &&
    isConsultationValid(consultation.validUntil, visit.on)
  );
}
