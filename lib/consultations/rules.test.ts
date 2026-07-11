import { describe, expect, it } from "vitest";
import {
  addDays,
  computeValidUntil,
  isConsultationValid,
  isRevisitFree,
} from "./rules";

describe("addDays", () => {
  it("adds within a month", () => {
    expect(addDays("2026-07-07", 7)).toBe("2026-07-14");
  });
  it("crosses a month boundary", () => {
    expect(addDays("2026-07-28", 7)).toBe("2026-08-04");
  });
  it("crosses a year boundary", () => {
    expect(addDays("2026-12-30", 5)).toBe("2027-01-04");
  });
  it("handles a leap day", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });
  it("adds zero (same day)", () => {
    expect(addDays("2026-07-07", 0)).toBe("2026-07-07");
  });
  it("rejects a malformed day", () => {
    expect(() => addDays("2026-7-7", 1)).toThrow();
    expect(() => addDays("not-a-date", 1)).toThrow();
  });
});

describe("computeValidUntil", () => {
  it("is start + validity days", () => {
    expect(computeValidUntil("2026-07-07", 7)).toBe("2026-07-14");
  });
  it("with 0 validity days covers only the start day", () => {
    expect(computeValidUntil("2026-07-07", 0)).toBe("2026-07-07");
  });
  it("rejects negative or non-integer validity", () => {
    expect(() => computeValidUntil("2026-07-07", -1)).toThrow();
    expect(() => computeValidUntil("2026-07-07", 1.5)).toThrow();
  });
});

describe("isConsultationValid", () => {
  const validUntil = "2026-07-14";
  it("is valid before the expiry day", () => {
    expect(isConsultationValid(validUntil, "2026-07-10")).toBe(true);
  });
  it("is valid ON the expiry day (inclusive)", () => {
    expect(isConsultationValid(validUntil, "2026-07-14")).toBe(true);
  });
  it("is NOT valid the day after expiry", () => {
    expect(isConsultationValid(validUntil, "2026-07-15")).toBe(false);
  });
});

describe("isRevisitFree", () => {
  const consultation = { doctorId: "10", validUntil: "2026-07-14" };

  it("is free for the same doctor while still valid", () => {
    expect(isRevisitFree(consultation, { doctorId: "10", on: "2026-07-10" })).toBe(true);
  });
  it("is free for the same doctor exactly on the expiry day", () => {
    expect(isRevisitFree(consultation, { doctorId: "10", on: "2026-07-14" })).toBe(true);
  });
  it("is NOT free for the same doctor after expiry", () => {
    expect(isRevisitFree(consultation, { doctorId: "10", on: "2026-07-15" })).toBe(false);
  });
  it("is NEVER free for a different doctor, even within validity", () => {
    expect(isRevisitFree(consultation, { doctorId: "99", on: "2026-07-10" })).toBe(false);
  });
  it("is not free for a different doctor on the expiry day either", () => {
    expect(isRevisitFree(consultation, { doctorId: "99", on: "2026-07-14" })).toBe(false);
  });
});
