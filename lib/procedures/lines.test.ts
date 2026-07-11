import { describe, expect, it } from "vitest";
import { computeLineTotal, computeSubtotal } from "./lines";

describe("computeLineTotal", () => {
  it("multiplies unit price by quantity", () => {
    expect(computeLineTotal(15000, 2)).toBe(30000);
    expect(computeLineTotal(0, 3)).toBe(0);
  });

  it("rejects a zero or negative quantity", () => {
    expect(() => computeLineTotal(1000, 0)).toThrow();
    expect(() => computeLineTotal(1000, -1)).toThrow();
  });

  it("rejects a non-integer quantity", () => {
    expect(() => computeLineTotal(1000, 1.5)).toThrow();
  });

  it("rejects a negative or non-integer unit price", () => {
    expect(() => computeLineTotal(-1, 1)).toThrow();
    expect(() => computeLineTotal(10.5, 1)).toThrow();
  });
});

describe("computeSubtotal", () => {
  it("sums line totals", () => {
    expect(
      computeSubtotal([
        { unitPricePaise: 10000, quantity: 2 },
        { unitPricePaise: 5000, quantity: 1 },
      ]),
    ).toBe(25000);
  });

  it("returns 0 for an empty list", () => {
    expect(computeSubtotal([])).toBe(0);
  });

  it("stays an exact integer for large values", () => {
    expect(
      computeSubtotal([{ unitPricePaise: 999_999_99, quantity: 999 }]),
    ).toBe(999_999_99 * 999);
  });

  it("propagates a bad line's error", () => {
    expect(() => computeSubtotal([{ unitPricePaise: 1000, quantity: 0 }])).toThrow();
  });
});
