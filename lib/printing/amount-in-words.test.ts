import { describe, expect, it } from "vitest";
import { amountInWords } from "./amount-in-words";

describe("amountInWords", () => {
  it("handles zero", () => {
    expect(amountInWords(0)).toBe("Zero Rupees Only");
  });

  it("handles a single rupee", () => {
    expect(amountInWords(100)).toBe("One Rupees Only");
  });

  it("handles paise-only amounts", () => {
    expect(amountInWords(5)).toBe("Zero Rupees and Five Paise Only");
    expect(amountInWords(45)).toBe("Zero Rupees and Forty Five Paise Only");
  });

  it("combines rupees and paise", () => {
    expect(amountInWords(25050)).toBe("Two Hundred Fifty Rupees and Fifty Paise Only");
  });

  it("crosses the lakh boundary", () => {
    // ₹1,23,456 → the plan's worked example.
    expect(amountInWords(12345600)).toBe(
      "One Lakh Twenty Three Thousand Four Hundred Fifty Six Rupees Only",
    );
    expect(amountInWords(10000000)).toBe("One Lakh Rupees Only"); // exactly ₹1,00,000
  });

  it("crosses the crore boundary", () => {
    expect(amountInWords(1000000000)).toBe("One Crore Rupees Only"); // ₹1,00,00,000
    expect(amountInWords(1234567800)).toBe(
      "One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Rupees Only",
    );
  });

  it("accepts a string (pg returns BIGINT as text)", () => {
    expect(amountInWords("25000")).toBe("Two Hundred Fifty Rupees Only");
  });
});
