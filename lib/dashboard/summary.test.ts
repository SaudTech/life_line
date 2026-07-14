import { describe, expect, it } from "vitest";
import {
  changePct,
  enumerateDays,
  IN_PATIENT_LABEL,
  monthStart,
  monthToDateRange,
  prevMonthComparableRange,
  seriesFromRows,
  shapeDepartmentSplit,
  sumPaise,
} from "./summary";

describe("changePct", () => {
  it("computes a positive change and rounds it", () => {
    // 15000 vs 12000 = +25%
    expect(changePct(15000, 12000)).toEqual({ pct: 25, direction: "up" });
  });

  it("computes a negative change", () => {
    // 9000 vs 12000 = -25%
    expect(changePct(9000, 12000)).toEqual({ pct: -25, direction: "down" });
  });

  it("reports a flat change as flat", () => {
    expect(changePct(10000, 10000)).toEqual({ pct: 0, direction: "flat" });
  });

  it("rounds to a whole percent", () => {
    // 10100 vs 10000 = +1% (1.0), 10050 vs 10000 = +0.5 -> rounds to +1 up
    expect(changePct(10100, 10000)).toEqual({ pct: 1, direction: "up" });
    expect(changePct(10050, 10000)).toEqual({ pct: 1, direction: "up" });
    // 10040 vs 10000 = +0.4 -> rounds to 0 -> flat (no meaningful move)
    expect(changePct(10040, 10000)).toEqual({ pct: 0, direction: "flat" });
  });

  it("returns null pct with no baseline (previous is zero)", () => {
    // Money today, nothing yesterday: no percentage, but it IS up.
    expect(changePct(15000, 0)).toEqual({ pct: null, direction: "up" });
    // Nothing today off nothing yesterday: flat, still no percentage.
    expect(changePct(0, 0)).toEqual({ pct: null, direction: "flat" });
  });
});

describe("enumerateDays", () => {
  it("lists inclusive days in order", () => {
    expect(enumerateDays("2026-07-11", "2026-07-14")).toEqual([
      "2026-07-11",
      "2026-07-12",
      "2026-07-13",
      "2026-07-14",
    ]);
  });

  it("returns a single day when from equals to", () => {
    expect(enumerateDays("2026-07-14", "2026-07-14")).toEqual(["2026-07-14"]);
  });

  it("returns empty when from is after to", () => {
    expect(enumerateDays("2026-07-15", "2026-07-14")).toEqual([]);
  });

  it("crosses a month boundary", () => {
    expect(enumerateDays("2026-07-30", "2026-08-01")).toEqual([
      "2026-07-30",
      "2026-07-31",
      "2026-08-01",
    ]);
  });
});

describe("seriesFromRows", () => {
  it("zero-fills missing days and preserves order", () => {
    const rows = [
      { day: "2026-07-12", paise: 5000 },
      { day: "2026-07-14", paise: 9000 },
    ];
    expect(seriesFromRows(rows, "2026-07-11", "2026-07-14")).toEqual([0, 5000, 0, 9000]);
  });

  it("ignores rows outside the range", () => {
    const rows = [
      { day: "2026-07-10", paise: 111 },
      { day: "2026-07-14", paise: 9000 },
    ];
    expect(seriesFromRows(rows, "2026-07-13", "2026-07-14")).toEqual([0, 9000]);
  });
});

describe("sumPaise", () => {
  it("sums a series", () => {
    expect(sumPaise([100, 200, 0, 50])).toBe(350);
  });
  it("is zero for an empty series", () => {
    expect(sumPaise([])).toBe(0);
  });
});

describe("month ranges", () => {
  it("monthStart returns the first of the month", () => {
    expect(monthStart("2026-07-14")).toBe("2026-07-01");
    expect(monthStart("2026-07-01")).toBe("2026-07-01");
  });

  it("monthToDateRange spans the 1st through today", () => {
    expect(monthToDateRange("2026-07-14")).toEqual({ from: "2026-07-01", to: "2026-07-14" });
  });

  it("prevMonthComparableRange takes an equal-length slice of last month", () => {
    // Jul 14 -> Jun 1..Jun 14 (same 14-day window).
    expect(prevMonthComparableRange("2026-07-14")).toEqual({
      from: "2026-06-01",
      to: "2026-06-14",
    });
  });

  it("prevMonthComparableRange clamps to the previous month's last day", () => {
    // Mar 31 -> Feb has no 31st; clamp to Feb 28 (2026 is not a leap year).
    expect(prevMonthComparableRange("2026-03-31")).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
    });
    // Leap year: clamp lands on the 29th.
    expect(prevMonthComparableRange("2028-03-31")).toEqual({
      from: "2028-02-01",
      to: "2028-02-29",
    });
  });

  it("prevMonthComparableRange crosses a year boundary", () => {
    // Jan 10 -> Dec 1..Dec 10 of the prior year.
    expect(prevMonthComparableRange("2026-01-10")).toEqual({
      from: "2025-12-01",
      to: "2025-12-10",
    });
  });
});

describe("shapeDepartmentSplit", () => {
  it("appends the in-patient bucket, sorts by revenue, and computes shares", () => {
    const rows = [
      { department: "Cardiologist", paise: 30000 },
      { department: "Orthopedician", paise: 10000 },
    ];
    // IP bucket 10000. Total = 50000 -> 60% / 20% / 20%.
    const out = shapeDepartmentSplit(rows, 10000);
    expect(out).toEqual([
      { department: "Cardiologist", paise: 30000, pct: 60 },
      { department: "Orthopedician", paise: 10000, pct: 20 },
      { department: IN_PATIENT_LABEL, paise: 10000, pct: 20 },
    ]);
  });

  it("omits the in-patient bucket when it holds no money", () => {
    const out = shapeDepartmentSplit([{ department: "Cardiologist", paise: 5000 }], 0);
    expect(out).toEqual([{ department: "Cardiologist", paise: 5000, pct: 100 }]);
  });

  it("drops zero-revenue departments", () => {
    const rows = [
      { department: "Cardiologist", paise: 5000 },
      { department: "Dentist", paise: 0 },
    ];
    const out = shapeDepartmentSplit(rows, 0);
    expect(out).toEqual([{ department: "Cardiologist", paise: 5000, pct: 100 }]);
  });

  it("returns an empty list on a zero-revenue day", () => {
    expect(shapeDepartmentSplit([], 0)).toEqual([]);
    expect(shapeDepartmentSplit([{ department: "Cardiologist", paise: 0 }], 0)).toEqual([]);
  });
});
