import { describe, it, expect } from "vitest";
import { doctorSharePaise, type DoctorShareConfig } from "./share";

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
