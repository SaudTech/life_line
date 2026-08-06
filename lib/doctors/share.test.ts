import { describe, it, expect } from "vitest";
import {
  describeShareRate,
  doctorSharePaise,
  snapshotDoctorShare,
  type DoctorShareConfig,
} from "./share";

// The doctor-share money rule (DEVELOPMENT_RULES §1/§4): pure, integer paise,
// covered before it is wired anywhere. The day sheet's guarantee rests on the
// clamp - doctor share + hospital share must equal the consultation collections,
// so a share can NEVER exceed what the bill collected.

const pct = (sharePercentage: number): DoctorShareConfig => ({
  shareType: "percentage",
  sharePercentage,
  shareFlatPaise: null,
});
const flat = (shareFlatPaise: number | null): DoctorShareConfig => ({
  shareType: "flat",
  sharePercentage: 0,
  shareFlatPaise,
});

describe("doctorSharePaise", () => {
  it("takes a whole percentage of the collected amount", () => {
    // The stated case: 40% of a ₹100 consultation → ₹40.
    expect(doctorSharePaise(10000, pct(40))).toBe(4000);
    expect(doctorSharePaise(25000, pct(50))).toBe(12500);
  });

  it("rounds a fractional paisa half-up (same convention as discounts)", () => {
    // 33% of ₹1.01 (101 paise) = 33.33 → 33; 15% of 110 paise = 16.5 → 17.
    expect(doctorSharePaise(101, pct(33))).toBe(33);
    expect(doctorSharePaise(110, pct(15))).toBe(17);
  });

  it("0% and 100% are exact - no share, and the whole collected amount", () => {
    expect(doctorSharePaise(10000, pct(0))).toBe(0);
    expect(doctorSharePaise(10000, pct(100))).toBe(10000);
  });

  it("takes a flat amount when configured that way", () => {
    expect(doctorSharePaise(30000, flat(25000))).toBe(25000);
  });

  it("clamps a flat share to what was actually collected", () => {
    // Flat ₹500 share, but the discounted consultation collected only ₹300 -
    // the hospital's remainder must never go negative.
    expect(doctorSharePaise(30000, flat(50000))).toBe(30000);
  });

  it("an unconfigured flat share (NULL) is zero, not a crash", () => {
    expect(doctorSharePaise(30000, flat(null))).toBe(0);
  });

  it("a zero-collected bill yields a zero share either way", () => {
    expect(doctorSharePaise(0, pct(40))).toBe(0);
    expect(doctorSharePaise(0, flat(50000))).toBe(0);
  });

  it("rejects invalid inputs instead of guessing", () => {
    expect(() => doctorSharePaise(-1, pct(40))).toThrow();
    expect(() => doctorSharePaise(100.5, pct(40))).toThrow();
    expect(() => doctorSharePaise(10000, pct(101))).toThrow();
    expect(() => doctorSharePaise(10000, pct(-1))).toThrow();
    expect(() => doctorSharePaise(10000, pct(40.5))).toThrow();
    expect(() => doctorSharePaise(10000, flat(-100))).toThrow();
  });
});

// The snapshot (migration 0025). What is FROZEN onto the bill at write time, so a
// rate changed later can never rewrite a payout slip that was already printed and
// paid out.
describe("snapshotDoctorShare", () => {
  it("freezes the amount AND the percentage rate that produced it", () => {
    expect(snapshotDoctorShare(1300000, pct(40))).toEqual({
      sharePaise: 520000,
      shareType: "percentage",
      sharePercentage: 40,
      shareFlatPaise: null,
    });
  });

  it("freezes the amount AND the flat rate that produced it", () => {
    expect(snapshotDoctorShare(30000, flat(25000))).toEqual({
      sharePaise: 25000,
      shareType: "flat",
      sharePercentage: null,
      shareFlatPaise: 25000,
    });
  });

  it("the frozen amount is the SAME rule the day sheet sums - clamp included", () => {
    // A flat ₹500 share on a ₹300 discounted consultation freezes at ₹300, so the
    // stored figure can never make the hospital's remainder negative either.
    const snap = snapshotDoctorShare(30000, flat(50000));
    expect(snap.sharePaise).toBe(doctorSharePaise(30000, flat(50000)));
    expect(snap.sharePaise).toBe(30000);
    // The RATE is still recorded as quoted (₹500), not as the clamped payout - the
    // slip must be able to say "flat ₹500, capped at what was collected".
    expect(snap.shareFlatPaise).toBe(50000);
  });

  it("the 14:00-paid / 18:00-raised case: the morning snapshot does not move", () => {
    // ₹13,000 collected at 40% is paid out as ₹5,200. Raising the doctor to 50%
    // afterwards produces a DIFFERENT snapshot for later bills, and the earlier
    // one is untouched - it is a stored value, not a recomputation.
    const morning = snapshotDoctorShare(1300000, pct(40));
    const evening = snapshotDoctorShare(1300000, pct(50));
    expect(morning.sharePaise).toBe(520000);
    expect(evening.sharePaise).toBe(650000);
  });

  it("normalises an unconfigured flat share so rate and amount agree", () => {
    // NULL flat pays ₹0; the snapshot records ₹0 rather than a null the slip
    // would have to invent a rendering for.
    expect(snapshotDoctorShare(30000, flat(null))).toEqual({
      sharePaise: 0,
      shareType: "flat",
      sharePercentage: null,
      shareFlatPaise: 0,
    });
  });

  it("a doctor on 0% freezes a real zero, not an absent rate", () => {
    const snap = snapshotDoctorShare(30000, pct(0));
    expect(snap.sharePaise).toBe(0);
    expect(snap.sharePercentage).toBe(0);
  });

  it("throws at WRITE time on a bad config rather than freezing a wrong number", () => {
    expect(() => snapshotDoctorShare(10000, pct(101))).toThrow();
    expect(() => snapshotDoctorShare(-1, pct(40))).toThrow();
  });
});

describe("describeShareRate", () => {
  const fmt = (paise: number) => (paise / 100).toFixed(2);

  it("words a percentage rate", () => {
    expect(describeShareRate({ shareType: "percentage", sharePercentage: 40, shareFlatPaise: null }, fmt)).toBe("40%");
  });

  it("words a flat rate in rupees", () => {
    expect(describeShareRate({ shareType: "flat", sharePercentage: null, shareFlatPaise: 50000 }, fmt)).toBe("₹500.00 flat");
  });

  it("0% is a rate and reads as one", () => {
    expect(describeShareRate({ shareType: "percentage", sharePercentage: 0, shareFlatPaise: null }, fmt)).toBe("0%");
  });

  it("a bill with no recorded rate returns null, never an invented one", () => {
    // Legacy pre-0025 rows and non-consultation bills. The caller decides what to
    // show; this must not guess a rate that was never stored.
    expect(describeShareRate({ shareType: null, sharePercentage: null, shareFlatPaise: null }, fmt)).toBeNull();
    expect(describeShareRate({ shareType: "percentage", sharePercentage: null, shareFlatPaise: null }, fmt)).toBeNull();
  });
});
