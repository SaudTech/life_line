import { describe, expect, it } from "vitest";
import {
  addDays,
  computeValidUntil,
  daysBetween,
  isConsultationValid,
  isRevisitFree,
} from "./rules";
import { resolveRevisitCharge } from "@/lib/doctors/revisit-tiers";

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

describe("daysBetween", () => {
  it("is 0 for the same day", () => {
    expect(daysBetween("2026-07-07", "2026-07-07")).toBe(0);
  });
  it("counts across a month boundary", () => {
    expect(daysBetween("2026-07-28", "2026-08-04")).toBe(7);
  });
  it("counts across a leap day", () => {
    expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2);
  });
  it("is negative when the second day is earlier", () => {
    expect(daysBetween("2026-07-07", "2026-07-05")).toBe(-2);
  });
  it("rejects a malformed day", () => {
    expect(() => daysBetween("2026-7-7", "2026-07-08")).toThrow();
  });
});

// How the consultation action prices a return visit (migrations 0027 + 0028):
// the free window is read back from the STORED row - the days between the run's
// anchor and its valid_until - so a doctor's window edited later cannot move it,
// while the priced rates come from the doctor as they stand now.
describe("pricing a return visit from a stored consultation", () => {
  // Booked 1 Jul with a 7-day window; ₹1,000 doctor, ₹400 through day 9, ₹700
  // through day 12.
  const anchor = "2026-07-01";
  const validUntil = "2026-07-08"; // anchor + 7
  const doctorTiers = [
    { throughDay: 9, pricePaise: 40_000 },
    { throughDay: 12, pricePaise: 70_000 },
  ];

  function charge(on: string) {
    return resolveRevisitCharge(
      {
        freeThroughDay: daysBetween(anchor, validUntil),
        tiers: doctorTiers,
        fullFeePaise: 100_000,
      },
      daysBetween(anchor, on),
    );
  }

  it("is free on the last day of the stored window", () => {
    expect(charge("2026-07-08").kind).toBe("free");
  });
  it("charges the first reduced rate the next day", () => {
    expect(charge("2026-07-09")).toEqual({ kind: "tier", pricePaise: 40_000, throughDay: 9 });
  });
  it("charges the second reduced rate later in the run", () => {
    expect(charge("2026-07-12")).toEqual({ kind: "tier", pricePaise: 70_000, throughDay: 12 });
  });
  it("becomes a new full-fee consultation once the taper runs out", () => {
    expect(charge("2026-07-14")).toEqual({ kind: "expired", pricePaise: 100_000 });
  });
  it("keeps counting from the ANCHOR, not from the paid revisit that renewed it", () => {
    // A paid revisit on 9 Jul writes a new row carrying the SAME anchor, so the
    // next visit is day 11 of the run - not day 2 of a new one, which would put
    // it back inside the free window and hand out an unpriced visit.
    expect(daysBetween(anchor, "2026-07-11")).toBe(10);
    expect(charge("2026-07-11").kind).toBe("tier");
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
