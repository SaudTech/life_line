import { describe, expect, it } from "vitest";
import {
  MAX_REVISIT_TIERS,
  bandRangeLabel,
  describeRevisitLadder,
  ladderThroughDay,
  resolveRevisitCharge,
  sortRevisitTiers,
  summarizeRevisitLadder,
  validateRevisitLadder,
  type RevisitLadder,
} from "./revisit-tiers";

// The worked example from the requirement, in paise: ₹1,000 fee, free for 7 days,
// ₹400 through day 9, ₹700 through day 12.
const LADDER: RevisitLadder = {
  freeThroughDay: 7,
  tiers: [
    { throughDay: 9, pricePaise: 40_000 },
    { throughDay: 12, pricePaise: 70_000 },
  ],
  fullFeePaise: 100_000,
};

// Today's behaviour: a free window and nothing else.
const PLAIN: RevisitLadder = { freeThroughDay: 7, tiers: [], fullFeePaise: 100_000 };

describe("resolveRevisitCharge", () => {
  it("is free on the consultation day itself", () => {
    expect(resolveRevisitCharge(LADDER, 0)).toEqual({ kind: "free", pricePaise: 0 });
  });
  it("is free on the last day of the free window", () => {
    expect(resolveRevisitCharge(LADDER, 7)).toEqual({ kind: "free", pricePaise: 0 });
  });
  it("charges the first band on the day right after the free window", () => {
    expect(resolveRevisitCharge(LADDER, 8)).toEqual({
      kind: "tier",
      pricePaise: 40_000,
      throughDay: 9,
    });
  });
  it("charges the first band through its last day", () => {
    expect(resolveRevisitCharge(LADDER, 9)).toEqual({
      kind: "tier",
      pricePaise: 40_000,
      throughDay: 9,
    });
  });
  it("charges the second band for every day it spans", () => {
    for (const day of [10, 11, 12]) {
      expect(resolveRevisitCharge(LADDER, day)).toEqual({
        kind: "tier",
        pricePaise: 70_000,
        throughDay: 12,
      });
    }
  });
  it("is a new full-fee consultation the day after the last band", () => {
    expect(resolveRevisitCharge(LADDER, 13)).toEqual({ kind: "expired", pricePaise: 100_000 });
    expect(resolveRevisitCharge(LADDER, 400)).toEqual({ kind: "expired", pricePaise: 100_000 });
  });

  it("with no priced bands behaves exactly as the free window alone did", () => {
    expect(resolveRevisitCharge(PLAIN, 7).kind).toBe("free");
    expect(resolveRevisitCharge(PLAIN, 8)).toEqual({ kind: "expired", pricePaise: 100_000 });
  });

  it("with a zero-day free window covers only the consultation day", () => {
    const sameDay: RevisitLadder = { freeThroughDay: 0, tiers: [], fullFeePaise: 100_000 };
    expect(resolveRevisitCharge(sameDay, 0).kind).toBe("free");
    expect(resolveRevisitCharge(sameDay, 1).kind).toBe("expired");
  });

  it("rejects a negative or fractional day", () => {
    expect(() => resolveRevisitCharge(LADDER, -1)).toThrow();
    expect(() => resolveRevisitCharge(LADDER, 1.5)).toThrow();
  });
});

describe("ladderThroughDay", () => {
  it("is the last band's day when there are bands", () => {
    expect(ladderThroughDay(LADDER)).toBe(12);
  });
  it("is the free window when there are none", () => {
    expect(ladderThroughDay(PLAIN)).toBe(7);
  });
});

describe("validateRevisitLadder", () => {
  const ok = { freeThroughDay: 7, tiers: LADDER.tiers, fullFeePaise: 100_000 };

  it("accepts the worked example", () => {
    expect(validateRevisitLadder(ok)).toBeNull();
  });
  it("accepts no bands at all", () => {
    expect(validateRevisitLadder({ freeThroughDay: 7, tiers: [], fullFeePaise: 100_000 })).toBeNull();
  });

  it("rejects a first band inside the free window", () => {
    const problem = validateRevisitLadder({
      freeThroughDay: 7,
      tiers: [{ throughDay: 7, pricePaise: 40_000 }],
      fullFeePaise: 100_000,
    });
    expect(problem).toMatchObject({ index: 0, field: "throughDay" });
  });
  it("rejects bands that do not strictly increase", () => {
    const problem = validateRevisitLadder({
      freeThroughDay: 7,
      tiers: [
        { throughDay: 9, pricePaise: 40_000 },
        { throughDay: 9, pricePaise: 70_000 },
      ],
      fullFeePaise: 100_000,
    });
    expect(problem).toMatchObject({ index: 1, field: "throughDay" });
  });
  it("rejects a fractional or negative day", () => {
    expect(
      validateRevisitLadder({ ...ok, tiers: [{ throughDay: 9.5, pricePaise: 40_000 }] }),
    ).toMatchObject({ index: 0, field: "throughDay" });
  });
  it("rejects a day past the cap", () => {
    expect(
      validateRevisitLadder({ ...ok, tiers: [{ throughDay: 3651, pricePaise: 40_000 }] }),
    ).toMatchObject({ index: 0, field: "throughDay" });
  });

  it("rejects a free (zero) band - that is what the free window is for", () => {
    expect(
      validateRevisitLadder({ ...ok, tiers: [{ throughDay: 9, pricePaise: 0 }] }),
    ).toMatchObject({ index: 0, field: "pricePaise" });
  });
  it("rejects a band priced at or above the full fee", () => {
    expect(
      validateRevisitLadder({ ...ok, tiers: [{ throughDay: 9, pricePaise: 100_000 }] }),
    ).toMatchObject({ index: 0, field: "pricePaise" });
    expect(
      validateRevisitLadder({ ...ok, tiers: [{ throughDay: 9, pricePaise: 150_000 }] }),
    ).toMatchObject({ index: 0, field: "pricePaise" });
  });
  it("skips the fee comparison when the fee itself is not a valid amount yet", () => {
    expect(
      validateRevisitLadder({ freeThroughDay: 7, tiers: ok.tiers, fullFeePaise: null }),
    ).toBeNull();
  });

  it("rejects more bands than the cap allows", () => {
    const tiers = Array.from({ length: MAX_REVISIT_TIERS + 1 }, (_, i) => ({
      throughDay: 8 + i,
      pricePaise: 10_000,
    }));
    expect(validateRevisitLadder({ ...ok, tiers })).toMatchObject({ field: "throughDay" });
  });
});

describe("sortRevisitTiers", () => {
  it("orders by day without mutating the input", () => {
    const input = [
      { throughDay: 12, pricePaise: 70_000 },
      { throughDay: 9, pricePaise: 40_000 },
    ];
    expect(sortRevisitTiers(input).map((t) => t.throughDay)).toEqual([9, 12]);
    expect(input[0].throughDay).toBe(12);
  });
});

describe("bandRangeLabel", () => {
  it("names a single day", () => {
    expect(bandRangeLabel(8, 8)).toBe("Day 8");
  });
  it("names a span", () => {
    expect(bandRangeLabel(8, 9)).toBe("Days 8-9");
  });
  it("names the consultation day on its own", () => {
    expect(bandRangeLabel(0, 0)).toBe("Same day");
  });
  it("shows a dash for an impossible span", () => {
    expect(bandRangeLabel(10, 9)).toBe("-");
  });
});

describe("describeRevisitLadder", () => {
  it("reads back the whole worked example, free window first and full fee last", () => {
    expect(describeRevisitLadder(LADDER)).toEqual([
      { range: "Days 0-7", amount: "Free", free: true, full: false },
      { range: "Days 8-9", amount: "400.00", free: false, full: false },
      { range: "Days 10-12", amount: "700.00", free: false, full: false },
      { range: "Day 13 onwards", amount: "1,000.00", free: false, full: true },
    ]);
  });
  it("is just the free window and the full fee when there are no bands", () => {
    expect(describeRevisitLadder(PLAIN)).toEqual([
      { range: "Days 0-7", amount: "Free", free: true, full: false },
      { range: "Day 8 onwards", amount: "1,000.00", free: false, full: true },
    ]);
  });
});

describe("summarizeRevisitLadder", () => {
  it("says just the window when nothing is priced", () => {
    expect(summarizeRevisitLadder(7, [])).toBe("Free 7 days");
  });
  it("counts the priced bands", () => {
    expect(summarizeRevisitLadder(7, LADDER.tiers)).toBe("Free 7 days, then 2 reduced rates");
  });
  it("uses singulars", () => {
    expect(summarizeRevisitLadder(1, [{ throughDay: 3, pricePaise: 100 }])).toBe(
      "Free 1 day, then 1 reduced rate",
    );
  });
  it("names a same-day-only window", () => {
    expect(summarizeRevisitLadder(0, [])).toBe("Free same day");
  });
});
