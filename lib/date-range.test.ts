import { describe, expect, it } from "vitest";
import {
  addDays,
  clinicDateLabel,
  clinicHour,
  clinicToday,
  presetRange,
} from "./date-range";

// These pin the clinic clock to Asia/Kolkata regardless of where the process runs.
// The bug they exist to catch: the admin header used the SERVER's clock, so on a UTC
// host it greeted "Good afternoon" and printed yesterday's date directly above cards
// computed for the real IST today (§5, honest system state).
describe("clinicHour", () => {
  it("reads the hour in Asia/Kolkata, not UTC (IST = UTC+5:30)", () => {
    // 18:00 UTC is 23:30 IST the same day.
    expect(clinicHour(new Date("2026-07-14T18:00:00Z"))).toBe(23);
    // 00:30 UTC is 06:00 IST.
    expect(clinicHour(new Date("2026-07-14T00:30:00Z"))).toBe(6);
  });

  it("normalises clinic midnight to 0, never 24", () => {
    // 18:30 UTC is exactly 00:00 IST the NEXT day.
    expect(clinicHour(new Date("2026-07-14T18:30:00Z"))).toBe(0);
  });

  it("stays in range across a full UTC day", () => {
    for (let h = 0; h < 24; h++) {
      const at = new Date(Date.UTC(2026, 6, 14, h));
      const hour = clinicHour(at);
      expect(hour).toBeGreaterThanOrEqual(0);
      expect(hour).toBeLessThanOrEqual(23);
    }
  });
});

describe("clinicDateLabel", () => {
  it("labels the CLINIC's date, which can be tomorrow's in UTC terms", () => {
    // 20:00 UTC on the 14th is already 01:30 IST on the 15th.
    expect(clinicDateLabel(new Date("2026-07-14T20:00:00Z"))).toBe("Wednesday, July 15");
  });

  it("agrees with clinicToday for the same instant", () => {
    // The header label and the day every figure is computed for must never disagree.
    const at = new Date("2026-07-14T19:00:00Z"); // 00:30 IST on the 15th
    expect(clinicToday(at)).toBe("2026-07-15");
    expect(clinicDateLabel(at)).toContain("July 15");
  });
});

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
