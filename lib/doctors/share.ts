// ONE definition of the doctor's share of a consultation - the cut owed to the
// doctor out of what the counter collected for a consultation bill.
//
// PURE and DB-free, mirroring lib/money-in.ts: the JS rule below is the tested
// truth (lib/doctors/share.test.ts) and `doctorShareSql` is the same rule as a
// SQL fragment so the report repository can sum it in one grouped query. If you
// change one, change the other - the tests will tell you if they drift.
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
// The share is computed at REPORT time from the doctor's current configuration
// (nothing is snapshotted on the bill) - editing a doctor's rate re-prices every
// day's sheet, past and future. That is the intended behaviour for a payout
// figure that is settled with the doctor, not with the patient.

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

// The SQL form of doctorSharePaise, for summing over bills joined to doctors.
// `collectedExpr` is the per-bill collected amount (use billCollectedSql from
// lib/money-in.ts); `doctorAlias` is the doctors table alias in the caller's
// query. Postgres round(numeric) is half-away-from-zero, which equals JS
// Math.round's half-up for the non-negative amounts here - the two stay in step.
export function doctorShareSql(collectedExpr: string, doctorAlias = "d"): string {
  const d = doctorAlias;
  return `LEAST(
            CASE WHEN ${d}.share_type = 'flat'
                 THEN COALESCE(${d}.share_flat_paise, 0)
                 ELSE round((${collectedExpr}) * ${d}.share_percentage / 100.0)::bigint
            END,
            (${collectedExpr}))`;
}
