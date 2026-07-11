import { describe, expect, it } from "vitest";
import { addDays, clinicToday, presetRange } from "./date-range";

describe("addDays", () => {
  it("adds and subtracts whole days", () => {
    expect(addDays("2026-07-09", 1)).toBe("2026-07-10");
    expect(addDays("2026-07-09", -1)).toBe("2026-07-08");
    expect(addDays("2026-07-09", 0)).toBe("2026-07-09");
  });

  it("rolls across month boundaries", () => {
    expect(addDays("2026-07-31", 1)).toBe("2026-08-01");
    expect(addDays("2026-08-01", -1)).toBe("2026-07-31");
  });

  it("rolls across year boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("handles the leap day", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2028-02-29", 1)).toBe("2028-03-01");
  });
});

describe("presetRange", () => {
  it("today is a single-day inclusive range", () => {
    expect(presetRange("today", "2026-07-09")).toEqual({
      dateFrom: "2026-07-09",
      dateTo: "2026-07-09",
    });
  });

  it("yesterday is the prior single day", () => {
    expect(presetRange("yesterday", "2026-07-09")).toEqual({
      dateFrom: "2026-07-08",
      dateTo: "2026-07-08",
    });
  });

  it("yesterday crosses a month boundary", () => {
    expect(presetRange("yesterday", "2026-08-01")).toEqual({
      dateFrom: "2026-07-31",
      dateTo: "2026-07-31",
    });
  });

  it("this week runs Monday through today (mid-week Thursday)", () => {
    // 2026-07-09 is a Thursday; the Monday of that week is 2026-07-06.
    expect(presetRange("week", "2026-07-09")).toEqual({
      dateFrom: "2026-07-06",
      dateTo: "2026-07-09",
    });
  });

  it("this week on a Monday is just that day", () => {
    // 2026-07-06 is a Monday.
    expect(presetRange("week", "2026-07-06")).toEqual({
      dateFrom: "2026-07-06",
      dateTo: "2026-07-06",
    });
  });

  it("this week on a Sunday spans the full Mon-Sun week", () => {
    // 2026-07-12 is a Sunday; its Monday is 2026-07-06.
    expect(presetRange("week", "2026-07-12")).toEqual({
      dateFrom: "2026-07-06",
      dateTo: "2026-07-12",
    });
  });

  it("this week can span a month boundary", () => {
    // 2026-08-01 is a Saturday; its Monday is 2026-07-27.
    expect(presetRange("week", "2026-08-01")).toEqual({
      dateFrom: "2026-07-27",
      dateTo: "2026-08-01",
    });
  });
});

describe("clinicToday", () => {
  it("formats the clinic day as YYYY-MM-DD", () => {
    expect(clinicToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("uses the Asia/Kolkata calendar day (ahead of UTC late evening)", () => {
    // 2026-07-09T20:00Z is 2026-07-10 01:30 in IST (UTC+5:30).
    expect(clinicToday(new Date("2026-07-09T20:00:00Z"))).toBe("2026-07-10");
  });
});
