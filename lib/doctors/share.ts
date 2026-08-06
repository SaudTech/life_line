// ONE definition of the doctor's share of a consultation - the cut owed to the
// doctor out of what the counter collected for a consultation bill.
//
// PURE and DB-free: the rules below are the tested truth
// (lib/doctors/share.test.ts) and nothing recomputes a share anywhere else.
//
// THE RULE. A doctor's share is configured per doctor (migration 0021) as EITHER
//   - a whole percentage (0-100) of each consultation, OR
//   - a flat paise amount per consultation,
// per `share_type` - only the matching value column is populated. The share is
// reckoned on what the bill actually COLLECTED (total_paise = fee − discount),
// not the list fee, so on the day sheet
//   doctor share + hospital share = consultation collections
// ties out exactly. It is clamped to the collected amount - a flat ₹500 share on
// a ₹300 discounted consultation is ₹300, never more - so the hospital's
// remainder can never go negative. All amounts are INTEGER paise (§4A).
//
// WHEN IT IS PRICED - and why that changed. The share used to be computed at READ
// time from the doctor's CURRENT configuration, so editing a rate re-priced every
// past day's sheet. Harmless while the figure was informational; a live defect once
// cash is handed over against it, because a rate raised at 18:00 silently rewrites
// the slip already paid out at 14:00 (migration 0025 has the full case). So the
// share is now SNAPSHOTTED onto the bill at the moment the bill is written, by
// `snapshotDoctorShare` below, and every reader sums the stored column. Changing a
// doctor's rate affects consultations billed AFTERWARDS and nothing else.
//
// There is deliberately NO SQL form of this rule any more. `doctorShareSql` existed
// so repositories could recompute a share in a grouped query; keeping it would keep
// live pricing one `sum()` away. Report queries sum bills.doctor_share_paise.

export interface DoctorShareConfig {
  shareType: "percentage" | "flat";
  sharePercentage: number; // whole percent, 0-100
  shareFlatPaise: number | null; // integer paise; null when shareType is 'percentage'
}

function assertNonNegInt(v: number, name: string): void {
  if (!Number.isInteger(v) || v < 0) {
    throw new Error(`${name} must be a non-negative integer, got: ${v}`);
  }
}

// The doctor's share of one consultation bill, in integer paise. Percentage is
// rounded to the nearest paisa (half-up, same convention as computeDiscountPaise
// in lib/billing/rules.ts); both forms are clamped to the collected amount.
export function doctorSharePaise(collectedPaise: number, cfg: DoctorShareConfig): number {
  assertNonNegInt(collectedPaise, "collectedPaise");
  if (cfg.shareType === "flat") {
    const flat = cfg.shareFlatPaise ?? 0;
    assertNonNegInt(flat, "shareFlatPaise");
    return Math.min(flat, collectedPaise);
  }
  const pct = cfg.sharePercentage;
  if (!Number.isInteger(pct) || pct < 0 || pct > 100) {
    throw new Error(`sharePercentage must be a whole number between 0 and 100, got: ${pct}`);
  }
  if (pct === 0) return 0;
  const raw = Math.round((collectedPaise * pct) / 100);
  return Math.min(raw, collectedPaise);
}

// ── The snapshot (migration 0025) ─────────────────────────────────────────────
// What gets FROZEN onto a consultation bill: the amount, plus the rate it came
// from. The rate rides along so a payout slip printed weeks later can say how the
// figure was arrived at ("40% of ₹13,000") without joining `doctors` and thereby
// reading today's rate onto yesterday's paper.
//
// Only the column matching `shareType` is meaningful; the other is null, mirroring
// how the doctor's own configuration is stored.
export interface DoctorShareSnapshot {
  sharePaise: number; // the frozen amount, integer paise
  shareType: "percentage" | "flat";
  sharePercentage: number | null; // whole percent when shareType = 'percentage'
  shareFlatPaise: number | null; // integer paise when shareType = 'flat'
}

// Price one consultation bill's doctor share and capture the rate that produced
// it, for storage. Call this ONCE, where the bill is written - never on read.
// `collectedPaise` is the bill's total (fee − discount), so the snapshot already
// accounts for a supervisor-approved discount applied at the counter.
export function snapshotDoctorShare(
  collectedPaise: number,
  cfg: DoctorShareConfig,
): DoctorShareSnapshot {
  // doctorSharePaise validates and clamps - a bad config throws here, at write
  // time, rather than silently freezing a wrong number onto a bill.
  const sharePaise = doctorSharePaise(collectedPaise, cfg);
  return cfg.shareType === "flat"
    ? {
        sharePaise,
        shareType: "flat",
        // Normalised: an unconfigured flat share reads as ₹0, matching the amount
        // the rule just produced, so the slip's rate and figure agree.
        shareFlatPaise: cfg.shareFlatPaise ?? 0,
        sharePercentage: null,
      }
    : {
        sharePaise,
        shareType: "percentage",
        sharePercentage: cfg.sharePercentage,
        shareFlatPaise: null,
      };
}

// How a stored rate reads on screen and on paper: "40%" / "₹500 flat". ONE
// definition, so the day sheet and the doctor-earnings sheet can never word the
// same rate differently. Returns null when the bill carries no rate at all (a
// procedure/IP bill, or a legacy consultation bill written before 0025) - the
// caller decides what to print in place of a rate it never had.
//
// `formatRupees` is injected (lib/money's formatPaise) to keep this module free of
// any dependency but itself.
export function describeShareRate(
  snapshot: { shareType: string | null; sharePercentage: number | null; shareFlatPaise: number | null },
  formatRupees: (paise: number) => string,
): string | null {
  if (snapshot.shareType === "percentage" && snapshot.sharePercentage != null) {
    return `${snapshot.sharePercentage}%`;
  }
  if (snapshot.shareType === "flat" && snapshot.shareFlatPaise != null) {
    return `₹${formatRupees(snapshot.shareFlatPaise)} flat`;
  }
  return null;
}
