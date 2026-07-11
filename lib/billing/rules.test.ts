import { describe, expect, it } from "vitest";
import {
  computeDiscountPaise,
  clampDiscountPaise,
  computeTotalPaise,
  canFinalizeBill,
} from "./rules";

describe("clampDiscountPaise", () => {
  it("passes a flat amount through when under the subtotal", () => {
    expect(clampDiscountPaise(60000, 15000)).toBe(15000);
  });
  it("clamps to the subtotal", () => {
    expect(clampDiscountPaise(60000, 90000)).toBe(60000);
  });
  it("is zero for a zero request", () => {
    expect(clampDiscountPaise(60000, 0)).toBe(0);
  });
  it("rejects a non-integer amount", () => {
    expect(() => clampDiscountPaise(60000, 100.5)).toThrow();
  });
});

describe("computeDiscountPaise", () => {
  it("is zero for a zero percent", () => {
    expect(computeDiscountPaise(60000, 0)).toBe(0);
  });
  it("takes a whole percent of the subtotal", () => {
    expect(computeDiscountPaise(60000, 10)).toBe(6000); // ₹600 → ₹60
    expect(computeDiscountPaise(60000, 15)).toBe(9000);
  });
  it("rounds to the nearest paisa (half-up)", () => {
    // 45000 * 15% = 6750 exactly; use a value that needs rounding:
    expect(computeDiscountPaise(45050, 15)).toBe(6758); // 6757.5 → 6758
  });
  it("never exceeds the subtotal", () => {
    expect(computeDiscountPaise(500, 100)).toBe(500);
  });
  it("rejects an out-of-range percent", () => {
    expect(() => computeDiscountPaise(1000, -1)).toThrow();
    expect(() => computeDiscountPaise(1000, 101)).toThrow();
  });
  it("rejects a non-integer subtotal", () => {
    expect(() => computeDiscountPaise(100.5, 10)).toThrow();
  });
});

describe("computeTotalPaise", () => {
  it("subtracts the discount", () => {
    expect(computeTotalPaise(60000, 6000)).toBe(54000);
  });
  it("is the full subtotal with no discount", () => {
    expect(computeTotalPaise(60000, 0)).toBe(60000);
  });
  it("can reach exactly zero", () => {
    expect(computeTotalPaise(500, 500)).toBe(0);
  });
  it("rejects a discount larger than the subtotal", () => {
    expect(() => computeTotalPaise(500, 600)).toThrow();
  });
});

describe("canFinalizeBill", () => {
  it("allows a bill with no discount and no approver", () => {
    expect(canFinalizeBill({ discountPaise: 0, approvedBy: null })).toBe(true);
  });
  it("blocks a discount with no approver", () => {
    expect(canFinalizeBill({ discountPaise: 6000, approvedBy: null })).toBe(false);
    expect(canFinalizeBill({ discountPaise: 6000, approvedBy: "" })).toBe(false);
  });
  it("allows a discount that has an approver", () => {
    expect(canFinalizeBill({ discountPaise: 6000, approvedBy: "user-123" })).toBe(true);
  });
});
