import { describe, it, expect } from "vitest";
import { calculateDischargeBalance } from "./discharge";

// Edge cases the rules call out (DEVELOPMENT_RULES §3): advance > total → refund,
// zero expenses, discount clamped to subtotal, exact-settle. Integer paise only.

describe("calculateDischargeBalance", () => {
  it("adds room + expenses into the subtotal and total (no discount, no advance)", () => {
    const r = calculateDischargeBalance({
      roomChargePaise: 200000, // ₹2,000
      expenses: [{ totalPaise: 30000 }, { totalPaise: 15000 }], // ₹300 + ₹150
      advancePaise: 0,
      discountPaise: 0,
    });
    expect(r.subtotalPaise).toBe(245000);
    expect(r.discountPaise).toBe(0);
    expect(r.totalPaise).toBe(245000);
    expect(r.balanceDuePaise).toBe(245000);
    expect(r.refundPaise).toBe(0);
  });

  it("subtracts the advance to leave a payable balance", () => {
    const r = calculateDischargeBalance({
      roomChargePaise: 200000,
      expenses: [{ totalPaise: 50000 }],
      advancePaise: 100000, // ₹1,000 advance
      discountPaise: 0,
    });
    expect(r.totalPaise).toBe(250000);
    expect(r.balanceDuePaise).toBe(150000);
    expect(r.refundPaise).toBe(0);
  });

  it("returns a refund when the advance exceeds the total (balance due 0)", () => {
    const r = calculateDischargeBalance({
      roomChargePaise: 100000,
      expenses: [{ totalPaise: 20000 }],
      advancePaise: 500000, // ₹5,000 advance, big
      discountPaise: 0,
    });
    expect(r.totalPaise).toBe(120000);
    expect(r.balanceDuePaise).toBe(0);
    expect(r.refundPaise).toBe(380000); // ₹3,800 back
  });

  it("computes cleanly with zero expenses (room only)", () => {
    const r = calculateDischargeBalance({
      roomChargePaise: 150000,
      expenses: [],
      advancePaise: 0,
      discountPaise: 0,
    });
    expect(r.subtotalPaise).toBe(150000);
    expect(r.totalPaise).toBe(150000);
    expect(r.balanceDuePaise).toBe(150000);
    expect(r.refundPaise).toBe(0);
  });

  it("computes cleanly with zero room AND zero expenses", () => {
    const r = calculateDischargeBalance({
      roomChargePaise: 0,
      expenses: [],
      advancePaise: 50000,
      discountPaise: 0,
    });
    expect(r.subtotalPaise).toBe(0);
    expect(r.totalPaise).toBe(0);
    expect(r.balanceDuePaise).toBe(0);
    expect(r.refundPaise).toBe(50000); // the whole advance is refunded
  });

  it("applies a discount to reduce the total", () => {
    const r = calculateDischargeBalance({
      roomChargePaise: 200000,
      expenses: [{ totalPaise: 100000 }],
      advancePaise: 0,
      discountPaise: 50000, // ₹500 off
    });
    expect(r.subtotalPaise).toBe(300000);
    expect(r.discountPaise).toBe(50000);
    expect(r.totalPaise).toBe(250000);
    expect(r.balanceDuePaise).toBe(250000);
  });

  it("clamps a discount larger than the subtotal (total never negative)", () => {
    const r = calculateDischargeBalance({
      roomChargePaise: 100000,
      expenses: [{ totalPaise: 20000 }],
      advancePaise: 0,
      discountPaise: 999999, // absurdly large
    });
    expect(r.subtotalPaise).toBe(120000);
    expect(r.discountPaise).toBe(120000); // clamped to subtotal
    expect(r.totalPaise).toBe(0);
    expect(r.balanceDuePaise).toBe(0);
    expect(r.refundPaise).toBe(0);
  });

  it("settles exactly to zero when the advance equals the total (neither balance nor refund)", () => {
    const r = calculateDischargeBalance({
      roomChargePaise: 200000,
      expenses: [{ totalPaise: 50000 }],
      advancePaise: 250000,
      discountPaise: 0,
    });
    expect(r.balanceDuePaise).toBe(0);
    expect(r.refundPaise).toBe(0);
  });

  it("combines discount then advance correctly", () => {
    const r = calculateDischargeBalance({
      roomChargePaise: 300000,
      expenses: [{ totalPaise: 100000 }, { totalPaise: 50000 }], // subtotal ₹4,500
      advancePaise: 200000, // ₹2,000
      discountPaise: 45000, // ₹450
    });
    expect(r.subtotalPaise).toBe(450000);
    expect(r.totalPaise).toBe(405000);
    expect(r.balanceDuePaise).toBe(205000); // 405000 − 200000
    expect(r.refundPaise).toBe(0);
  });

  it("rejects non-integer / negative money inputs (never a float in the money path)", () => {
    expect(() =>
      calculateDischargeBalance({ roomChargePaise: 100.5, expenses: [], advancePaise: 0, discountPaise: 0 }),
    ).toThrow();
    expect(() =>
      calculateDischargeBalance({ roomChargePaise: -100, expenses: [], advancePaise: 0, discountPaise: 0 }),
    ).toThrow();
    expect(() =>
      calculateDischargeBalance({
        roomChargePaise: 100,
        expenses: [{ totalPaise: 1.7 }],
        advancePaise: 0,
        discountPaise: 0,
      }),
    ).toThrow();
  });
});
