import { describe, it, expect } from "vitest";
import {
  shapeDailyReport,
  emptyMoneyRaw,
  BILL_TYPES,
  type MoneyRaw,
} from "./summary";
import { PAYMENT_MODES } from "@/lib/consultations/schema";

// The daily report's money math is server-computed in this pure shaper (plan §4);
// the UI only renders what it returns. These cover the cases the plan calls out
// (§3/§7): an empty day → all zeros (no crash), mixed payment modes, discounts
// (on my bills + ones I approved), and a void EXCLUDED from the collected total.

describe("shapeDailyReport", () => {
  it("an empty day is all zeros with an honest isEmpty flag (never a crash)", () => {
    const r = shapeDailyReport([], emptyMoneyRaw());

    expect(r.isEmpty).toBe(true);
    expect(r.activity).toEqual([]);
    expect(r.activityTotal).toBe(0);
    expect(r.collectedTotalPaise).toBe(0);
    expect(r.collectedCount).toBe(0);
    expect(r.advancesTotalPaise).toBe(0);
    expect(r.voids).toEqual({ count: 0, totalPaise: 0 });

    // Every type + mode is still present as a zero-filled row (fixed layout).
    expect(r.byType.map((l) => l.key)).toEqual([...BILL_TYPES]);
    expect(r.byMode.map((l) => l.key)).toEqual([...PAYMENT_MODES]);
    expect(r.byMode.every((l) => l.count === 0 && l.totalPaise === 0)).toBe(true);
    expect(r.advancesByMode.map((l) => l.key)).toEqual([...PAYMENT_MODES]);
  });

  it("splits collected money by type and by payment mode, and totals the modes", () => {
    const money: MoneyRaw = {
      ...emptyMoneyRaw(),
      billsByType: [
        { key: "consultation", count: 3, totalPaise: 60000 }, // ₹600
        { key: "procedure", count: 2, totalPaise: 40000 }, // ₹400
      ],
      billsByMode: [
        { key: "cash", count: 3, totalPaise: 70000 }, // ₹700
        { key: "upi", count: 2, totalPaise: 30000 }, // ₹300
      ],
    };
    const r = shapeDailyReport([], money);

    // Reconciliation total is the sum of the by-mode lines.
    expect(r.collectedTotalPaise).toBe(100000);
    expect(r.collectedCount).toBe(5);

    // By-type and by-mode agree on the grand total (same underlying bills).
    const typeTotal = r.byType.reduce((s, l) => s + l.totalPaise, 0);
    expect(typeTotal).toBe(r.collectedTotalPaise);

    // Cash line carries its own count/total; card is a zero-filled row.
    const cash = r.byMode.find((l) => l.key === "cash")!;
    expect(cash).toMatchObject({ count: 3, totalPaise: 70000, label: "Cash" });
    const card = r.byMode.find((l) => l.key === "card")!;
    expect(card).toMatchObject({ count: 0, totalPaise: 0 });

    expect(r.isEmpty).toBe(false);
  });

  it("surfaces discounts on my bills and discounts I approved, distinctly", () => {
    const money: MoneyRaw = {
      ...emptyMoneyRaw(),
      billsByMode: [{ key: "cash", count: 1, totalPaise: 90000 }],
      discountOnMyBillsPaise: 10000, // ₹100 off my own bills
      discountsApproved: { count: 4, totalPaise: 25000 }, // approved for others
    };
    const r = shapeDailyReport([], money);

    expect(r.discountOnMyBillsPaise).toBe(10000);
    expect(r.discountsApproved).toEqual({ count: 4, totalPaise: 25000 });
    // Approving a discount doesn't add revenue - the collected total is unchanged.
    expect(r.collectedTotalPaise).toBe(90000);
  });

  it("shows voids separately and EXCLUDES them from the collected total", () => {
    const money: MoneyRaw = {
      ...emptyMoneyRaw(),
      // A bill finalized earlier then voided today appears ONLY under voids - the
      // by-mode rows are the non-void bills, so the void is not in the total.
      billsByMode: [{ key: "cash", count: 2, totalPaise: 50000 }],
      voids: { count: 1, totalPaise: 20000 },
    };
    const r = shapeDailyReport([], money);

    expect(r.collectedTotalPaise).toBe(50000); // void's ₹200 is NOT added in
    expect(r.voids).toEqual({ count: 1, totalPaise: 20000 });
    expect(r.isEmpty).toBe(false); // a void-only day still has something to show
  });

  it("attributes admission advances by mode, separate from bill revenue", () => {
    const money: MoneyRaw = {
      ...emptyMoneyRaw(),
      billsByMode: [{ key: "cash", count: 1, totalPaise: 30000 }],
      advancesByMode: [
        { key: "cash", count: 1, totalPaise: 500000 }, // ₹5,000 deposit
        { key: "card", count: 1, totalPaise: 200000 }, // ₹2,000 deposit
      ],
    };
    const r = shapeDailyReport([], money);

    expect(r.advancesTotalPaise).toBe(700000);
    expect(r.advancesCount).toBe(2);
    // Deposits are money held, not finalized revenue - kept out of the collected total.
    expect(r.collectedTotalPaise).toBe(30000);
  });

  it("labels + orders the activity summary, dropping tags that didn't happen", () => {
    const r = shapeDailyReport(
      [
        { action: "bill.void", count: 1 },
        { action: "consultation.create", count: 5 },
        { action: "patient.create", count: 2 },
        { action: "bill.finalize", count: 9 }, // not a report tag - ignored
      ],
      emptyMoneyRaw(),
    );

    // Only the curated tags that occurred, in the fixed report order
    // (patient.create before consultation.create before bill.void).
    expect(r.activity.map((a) => a.action)).toEqual([
      "patient.create",
      "consultation.create",
      "bill.void",
    ]);
    expect(r.activityTotal).toBe(8);
    // Labels/tone come from the canonical registry.
    const voided = r.activity.find((a) => a.action === "bill.void")!;
    expect(voided.label).toBe("Bill voided");
    expect(voided.tone).toBe("danger");
  });
});
