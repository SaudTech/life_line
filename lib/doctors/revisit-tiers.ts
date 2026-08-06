import { formatPaise } from "@/lib/money";

// Tapered revisit pricing (migration 0027). PURE and client-safe - no "use
// server", no DB - so the admin form, the server action and (later) the
// consultation flow all reach the SAME decision from the same function
// (DEVELOPMENT_RULES §1: one source of truth per rule, never re-implemented for
// a UI "preview").
//
// THE LADDER. A doctor has a free window (doctors.revisit_validity_days) and,
// optionally, priced bands after it. Days are counted from the first
// consultation: day 0 is the consultation itself, so a free window of 7 covers
// days 0-7 inclusive - exactly what computeValidUntil/isConsultationValid
// already mean (lib/consultations/rules.ts).
//
//   free window 7, bands [(9, ₹400), (12, ₹700)], fee ₹1,000
//     days 0-7   free
//     days 8-9   ₹400
//     days 10-12 ₹700
//     day 13+    a new consultation at ₹1,000
//
// A band is identified by the day it runs THROUGH, so consecutive bands cannot
// leave a day unpriced. The bands are held sorted and strictly increasing, each
// above the free window - `validateRevisitLadder` is what guarantees it, and it
// runs in the zod schema (client) and again in the server action (authoritative).

export interface RevisitTier {
  throughDay: number;
  pricePaise: number;
}

// A doctor's whole revisit price ladder, as both the form and the resolver see it.
export interface RevisitLadder {
  freeThroughDay: number;
  tiers: RevisitTier[];
  fullFeePaise: number;
}

// Four priced bands past the free window is already more taper than any counter
// clerk can hold in their head; the cap keeps the admin form from growing without
// bound and the summary line readable.
export const MAX_REVISIT_TIERS = 4;

// Matches the CHECK in migration 0027 and revisitValidityDays in the doctor schema.
export const MAX_REVISIT_DAY = 3650;

// What a revisit on a given day costs.
//   free    - inside the free window, no bill (today's behaviour)
//   tier    - inside a priced band: charge pricePaise, still the SAME consultation
//   expired - past the last band: not a revisit at all, a new full-fee consultation
export type RevisitCharge =
  | { kind: "free"; pricePaise: 0 }
  | { kind: "tier"; pricePaise: number; throughDay: number }
  | { kind: "expired"; pricePaise: number };

// THE rule. `daysSince` is whole days elapsed since the consultation started
// (0 = same day). Bands are scanned in order, so the first one that still covers
// the day wins; falling off the end means the taper is over and the patient
// starts a new consultation at the full fee.
export function resolveRevisitCharge(ladder: RevisitLadder, daysSince: number): RevisitCharge {
  if (!Number.isInteger(daysSince) || daysSince < 0) {
    throw new Error(`daysSince must be a non-negative integer, got: ${daysSince}`);
  }
  if (daysSince <= ladder.freeThroughDay) return { kind: "free", pricePaise: 0 };
  for (const tier of ladder.tiers) {
    if (daysSince <= tier.throughDay) {
      return { kind: "tier", pricePaise: tier.pricePaise, throughDay: tier.throughDay };
    }
  }
  return { kind: "expired", pricePaise: ladder.fullFeePaise };
}

// The last day the ladder covers at all - past it, a visit is a new consultation.
// With no priced bands that is just the free window, i.e. today's behaviour.
export function ladderThroughDay(ladder: Pick<RevisitLadder, "freeThroughDay" | "tiers">): number {
  return ladder.tiers.length > 0
    ? ladder.tiers[ladder.tiers.length - 1].throughDay
    : ladder.freeThroughDay;
}

// Where a ladder is malformed, and which input to blame - the caller maps
// `index`/`field` onto the form row so the message lands on the offending input
// rather than on the form as a whole. `null` means the ladder is sound.
export interface RevisitLadderProblem {
  index: number; // index into `tiers`
  field: "throughDay" | "pricePaise";
  message: string;
}

// Every way a ladder can be wrong, in the order a person filling the form would
// hit them. `fullFeePaise` may be null when the fee input isn't a valid amount
// yet - the band-vs-fee check is simply skipped rather than blaming the band for
// a broken fee.
export function validateRevisitLadder(input: {
  freeThroughDay: number;
  tiers: RevisitTier[];
  fullFeePaise: number | null;
}): RevisitLadderProblem | null {
  const { freeThroughDay, tiers, fullFeePaise } = input;

  if (tiers.length > MAX_REVISIT_TIERS) {
    return {
      index: MAX_REVISIT_TIERS,
      field: "throughDay",
      message: `At most ${MAX_REVISIT_TIERS} reduced rates.`,
    };
  }

  // The day the previous band ended - the free window for the first one.
  let previousDay = freeThroughDay;

  for (let i = 0; i < tiers.length; i++) {
    const { throughDay, pricePaise } = tiers[i];

    if (!Number.isInteger(throughDay) || throughDay < 0) {
      return { index: i, field: "throughDay", message: "Whole days only." };
    }
    if (throughDay > MAX_REVISIT_DAY) {
      return { index: i, field: "throughDay", message: "That's too many days." };
    }
    // Strictly increasing, and clear of the free window: a band that ends on or
    // before the previous one covers no days at all, and one inside the free
    // window would be charging for days already given away.
    if (throughDay <= previousDay) {
      return {
        index: i,
        field: "throughDay",
        message:
          i === 0
            ? `Must be after the free window (day ${freeThroughDay}).`
            : `Must be after day ${previousDay}.`,
      };
    }

    if (!Number.isInteger(pricePaise) || pricePaise <= 0) {
      // Zero is not "free" here - it's an unnoticed way to extend the free window
      // without the free window saying so. Say that plainly.
      return {
        index: i,
        field: "pricePaise",
        message: "Enter an amount above 0, or extend the free window instead.",
      };
    }
    if (fullFeePaise !== null && pricePaise >= fullFeePaise) {
      return {
        index: i,
        field: "pricePaise",
        message: "Must be less than the consultation fee.",
      };
    }

    previousDay = throughDay;
  }

  return null;
}

// Sort into the order the resolver relies on. Callers that read bands from a form
// (where rows can be added out of order) run this before validating or resolving;
// the DB already returns them ordered.
// Generic so a caller can carry its own baggage on each row - the admin form
// sorts rows that also remember which INPUT they came from, so an error can be
// reported against the row the admin is looking at.
export function sortRevisitTiers<T extends RevisitTier>(tiers: T[]): T[] {
  return [...tiers].sort((a, b) => a.throughDay - b.throughDay);
}

// ---------------------------------------------------------------------------
// Wording. Both the admin form's live ladder and the doctor list read the SAME
// phrasing from here, so what an admin sets is worded identically to what the
// list shows back.

// The span a band covers, in the "days since the first consultation" the whole
// module counts in: "Days 8-9", "Day 8", "Same day" for the day-0 case.
export function bandRangeLabel(fromDay: number, throughDay: number): string {
  if (throughDay < fromDay) return "-";
  if (fromDay === 0 && throughDay === 0) return "Same day";
  if (fromDay === throughDay) return `Day ${fromDay}`;
  return `Days ${fromDay}-${throughDay}`;
}

export interface RevisitBand {
  range: string; // "Days 8-9"
  amount: string; // "Free", "400.00", "1,000.00" - rupees, no symbol (the UI adds ₹)
  free: boolean;
  full: boolean; // the trailing "new consultation" band
}

// The whole ladder as display rows, free window first and the full-fee tail last.
// Pure formatting only - it never decides anything, it renders what
// resolveRevisitCharge would decide.
export function describeRevisitLadder(ladder: RevisitLadder): RevisitBand[] {
  const bands: RevisitBand[] = [
    {
      range: bandRangeLabel(0, ladder.freeThroughDay),
      amount: "Free",
      free: true,
      full: false,
    },
  ];
  let from = ladder.freeThroughDay + 1;
  for (const tier of ladder.tiers) {
    bands.push({
      range: bandRangeLabel(from, tier.throughDay),
      amount: formatPaise(tier.pricePaise),
      free: false,
      full: false,
    });
    from = tier.throughDay + 1;
  }
  bands.push({
    range: `Day ${ladderThroughDay(ladder) + 1} onwards`,
    amount: formatPaise(ladder.fullFeePaise),
    free: false,
    full: true,
  });
  return bands;
}

// One line for the doctors list, where there's room for a phrase and not a table.
//   "Free 7 days" · "Free 7 days, then 2 reduced rates"
export function summarizeRevisitLadder(freeThroughDay: number, tiers: RevisitTier[]): string {
  const window =
    freeThroughDay === 0 ? "Free same day" : `Free ${freeThroughDay} ${freeThroughDay === 1 ? "day" : "days"}`;
  if (tiers.length === 0) return window;
  return `${window}, then ${tiers.length} reduced ${tiers.length === 1 ? "rate" : "rates"}`;
}
