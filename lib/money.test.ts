import { describe, expect, it } from "vitest";
import { isValidRupees, isRupeesTooLarge, rupeesToPaise, formatPaise } from "./money";

describe("rupeesToPaise", () => {
  it("converts whole and fractional rupees to integer paise", () => {
    expect(rupeesToPaise("250")).toBe(25000);
    expect(rupeesToPaise("250.5")).toBe(25050); // single decimal padded to ".50"
    expect(rupeesToPaise("250.55")).toBe(25055);
    expect(rupeesToPaise("0")).toBe(0);
    expect(rupeesToPaise("0.05")).toBe(5);
  });

  it("trims surrounding whitespace before parsing", () => {
    expect(rupeesToPaise("  250.50  ")).toBe(25050);
  });

  it("throws on anything that isn't a clean rupee amount", () => {
    expect(() => rupeesToPaise("abc")).toThrow();
    expect(() => rupeesToPaise("1.234")).toThrow(); // too many decimals
    expect(() => rupeesToPaise("-5")).toThrow();
    expect(() => rupeesToPaise("")).toThrow();
    expect(() => rupeesToPaise("1.")).toThrow();
    expect(() => rupeesToPaise("12345678")).toThrow(); // 8 whole digits - over cap
  });
});

describe("formatPaise", () => {
  it("formats paise as rupees with two decimals", () => {
    expect(formatPaise(25000)).toBe("250.00");
    expect(formatPaise(0)).toBe("0.00");
    expect(formatPaise(5)).toBe("0.05");
  });

  it("groups with Indian digit grouping", () => {
    expect(formatPaise(2550050)).toBe("25,500.50");
  });

  it("accepts a string (pg returns BIGINT as text)", () => {
    expect(formatPaise("30000")).toBe("300.00");
  });
});

describe("isValidRupees", () => {
  it("accepts valid amounts at the boundaries", () => {
    expect(isValidRupees("0")).toBe(true);
    expect(isValidRupees("250")).toBe(true);
    expect(isValidRupees("250.5")).toBe(true);
    expect(isValidRupees("250.55")).toBe(true);
    expect(isValidRupees("9999999.99")).toBe(true); // 7 whole digits - the cap
    expect(isValidRupees("  250  ")).toBe(true); // trimmed
  });

  it("rejects malformed amounts", () => {
    expect(isValidRupees("")).toBe(false);
    expect(isValidRupees("abc")).toBe(false);
    expect(isValidRupees("1.234")).toBe(false);
    expect(isValidRupees("-5")).toBe(false);
    expect(isValidRupees("1.")).toBe(false);
    expect(isValidRupees("12345678")).toBe(false); // 8 whole digits
  });
});

describe("isRupeesTooLarge", () => {
  it("flags a well-formed amount over the 7-digit cap", () => {
    expect(isRupeesTooLarge("99999999")).toBe(true);
    expect(isRupeesTooLarge("12345678.90")).toBe(true);
  });

  it("does not flag amounts at or under the cap", () => {
    expect(isRupeesTooLarge("9999999")).toBe(false);
    expect(isRupeesTooLarge("250")).toBe(false);
  });

  it("does not flag input that isn't shaped like a number at all", () => {
    expect(isRupeesTooLarge("abc")).toBe(false);
    expect(isRupeesTooLarge("")).toBe(false);
    expect(isRupeesTooLarge("1.234")).toBe(false); // bad shape, not "too large"
  });
});
