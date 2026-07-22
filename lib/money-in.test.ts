import { describe, expect, it } from "vitest";
import { calculateDischargeBalance } from "@/lib/billing/discharge";
import {
  billCollectedPaise,
  billCollectedSql,
  billMoneyInPaise,
  billMoneyInSql,
  clinicRange,
  toPaise,
} from "@/lib/money-in";

// The rule these tests defend: money-in counts what the hospital COLLECTED, and an
// admission advance is collected exactly ONCE - at admit. The regression they exist to
// catch is the advance being counted a second time inside the discharge bill's total
// (see migration 0018). If someone makes an IP bill contribute total_paise again, the
// "never double-counts" test below fails loudly - which is the whole point (§3).

describe("billMoneyInPaise", () => {
  it("counts an OP bill's full total - it is settled when issued", () => {
    expect(
      billMoneyInPaise({
        type: "consultation",
        totalPaise: 30000,
        balanceDuePaise: 0,
        refundPaise: 0,
      }),
    ).toBe(30000);
  });

  it("counts a procedure bill's full total", () => {
    expect(
      billMoneyInPaise({ type: "procedure", totalPaise: 45000, balanceDuePaise: 0, refundPaise: 0 }),
    ).toBe(45000);
  });

  it("counts ONLY the balance due on an IP bill - never its gross total", () => {
    // Gross total 15000 contains the 10000 advance already taken at admit.
    const contribution = billMoneyInPaise({
      type: "ip",
      totalPaise: 1500000,
      balanceDuePaise: 500000,
      refundPaise: 0,
    });
    expect(contribution).toBe(500000);
    expect(contribution).not.toBe(1500000); // the double-count, spelled out
  });

  it("goes NEGATIVE when a discharge refunds - cash leaving the drawer", () => {
    // Advance 10000, total 6000 -> 4000 handed back. The day's money-in must fall.
    expect(
      billMoneyInPaise({ type: "ip", totalPaise: 600000, balanceDuePaise: 0, refundPaise: 400000 }),
    ).toBe(-400000);
  });

  it("contributes zero when the advance settles the total exactly", () => {
    expect(
      billMoneyInPaise({ type: "ip", totalPaise: 1000000, balanceDuePaise: 0, refundPaise: 0 }),
    ).toBe(0);
  });
});

// The reconciliation that used to be nobody's job. A stay's money-in, summed across
// BOTH clinic days it touches, must equal what the counter actually took - never the
// advance plus a total that already contains it.
describe("a full stay reconciles to cash collected", () => {
  // What the dashboard/report do: advance on the admit day + the bill's contribution
  // on the discharge day.
  function stayMoneyIn(advancePaise: number, balance: ReturnType<typeof calculateDischargeBalance>) {
    return (
      advancePaise +
      billMoneyInPaise({
        type: "ip",
        totalPaise: balance.totalPaise,
        balanceDuePaise: balance.balanceDuePaise,
        refundPaise: balance.refundPaise,
      })
    );
  }

  it("never double-counts the advance (the 0018 regression)", () => {
    const advancePaise = 1000000; // ₹10,000 at admit
    const balance = calculateDischargeBalance({
      roomChargePaise: 1500000, // ₹15,000 gross
      expenses: [],
      advancePaise,
      discountPaise: 0,
    });

    // Cash actually taken: ₹10,000 at admit + ₹5,000 at discharge = ₹15,000.
    expect(stayMoneyIn(advancePaise, balance)).toBe(1500000);
    // The old bug summed advance + total_paise and reported ₹25,000.
    expect(stayMoneyIn(advancePaise, balance)).not.toBe(advancePaise + balance.totalPaise);
  });

  it("a stay's money-in always equals its gross total when nothing is refunded", () => {
    const advancePaise = 250000;
    const balance = calculateDischargeBalance({
      roomChargePaise: 800000,
      expenses: [{ totalPaise: 120000 }, { totalPaise: 30000 }],
      advancePaise,
      discountPaise: 50000,
    });
    // advance + balanceDue telescopes back to the gross total, by construction.
    expect(stayMoneyIn(advancePaise, balance)).toBe(balance.totalPaise);
  });

  it("a refunded stay nets to the total, not to the advance", () => {
    const advancePaise = 1000000; // over-paid at admit
    const balance = calculateDischargeBalance({
      roomChargePaise: 600000,
      expenses: [],
      advancePaise,
      discountPaise: 0,
    });
    expect(balance.refundPaise).toBe(400000);
    // Took ₹10,000, gave ₹4,000 back -> kept ₹6,000, the real bill.
    expect(stayMoneyIn(advancePaise, balance)).toBe(600000);
    expect(stayMoneyIn(advancePaise, balance)).toBe(balance.totalPaise);
  });

  it("a zero-advance stay is unaffected (the case the old bug got right)", () => {
    const balance = calculateDischargeBalance({
      roomChargePaise: 700000,
      expenses: [],
      advancePaise: 0,
      discountPaise: 0,
    });
    expect(stayMoneyIn(0, balance)).toBe(700000);
  });
});

// The JS rule and the SQL rule must stay the same rule. These pin the shape so a
// careless edit to one is visible.
describe("billMoneyInSql", () => {
  it("branches on type, reading balance/refund for IP and total otherwise", () => {
    const sql = billMoneyInSql();
    expect(sql).toContain("type = 'ip'");
    expect(sql).toContain("balance_due_paise");
    expect(sql).toContain("- refund_paise");
    expect(sql).toContain("ELSE total_paise");
  });

  it("qualifies every column with the caller's alias", () => {
    const sql = billMoneyInSql("b");
    expect(sql).toContain("b.type = 'ip'");
    expect(sql).toContain("b.balance_due_paise");
    expect(sql).toContain("- b.refund_paise");
    expect(sql).toContain("ELSE b.total_paise");
    expect(sql).not.toMatch(/(?<!\.)\btotal_paise\b/); // never an unqualified column
  });
});

// `collected` is money TAKEN. It must never subtract a refund - the report sheet shows
// the refund as its own line and subtracts it once, so a refund netted in here too
// would leave a refunded day short by twice the refund.
describe("billCollectedPaise / billCollectedSql", () => {
  it("counts an OP bill's full total", () => {
    expect(billCollectedPaise({ type: "consultation", totalPaise: 30000, balanceDuePaise: 0 })).toBe(
      30000,
    );
  });

  it("counts ONLY an IP bill's balance due, never its gross total", () => {
    expect(billCollectedPaise({ type: "ip", totalPaise: 1500000, balanceDuePaise: 500000 })).toBe(
      500000,
    );
  });

  it("is ZERO for a fully-advanced stay - the refund is not its business", () => {
    // The 14 Jul case: billed ₹18,000, ₹20,000 advance, ₹2,000 back. Nothing was
    // COLLECTED at discharge; the refund leaves on its own line.
    expect(billCollectedPaise({ type: "ip", totalPaise: 1800000, balanceDuePaise: 0 })).toBe(0);
  });

  it("never subtracts a refund (billMoneyInPaise is the net)", () => {
    const bill = { type: "ip" as const, totalPaise: 1800000, balanceDuePaise: 0 };
    expect(billCollectedPaise(bill)).toBe(0);
    expect(billMoneyInPaise({ ...bill, refundPaise: 200000 })).toBe(-200000);
  });

  it("SQL reads balance for IP and total otherwise, with no refund term", () => {
    const sql = billCollectedSql();
    expect(sql).toContain("type = 'ip'");
    expect(sql).toContain("balance_due_paise");
    expect(sql).toContain("ELSE total_paise");
    expect(sql).not.toContain("refund_paise");
  });

  it("SQL qualifies every column with the caller's alias", () => {
    const sql = billCollectedSql("b");
    expect(sql).toContain("b.type = 'ip'");
    expect(sql).toContain("b.balance_due_paise");
    expect(sql).toContain("ELSE b.total_paise");
    expect(sql).not.toMatch(/(?<!\.)\btotal_paise\b/);
  });
});

describe("clinicRange", () => {
  it("is half-open [from 00:00 IST, (to+1) 00:00 IST) so a day is never double-counted", () => {
    const sql = clinicRange("created_at", 1, 2);
    expect(sql).toContain(">= ($1::date)");
    expect(sql).toMatch(/<\s+\(\(\$2::date \+ 1\)\)/);
    expect(sql).toContain("Asia/Kolkata");
  });

  it("never wraps the filtered column in a function, so the index stays usable", () => {
    // The column must appear bare on the left of each comparison (migration 0019).
    const sql = clinicRange("b.admitted_at", 3, 4);
    expect(sql).toMatch(/^\s*b\.admitted_at >=/);
    expect(sql).toContain("AND b.admitted_at <");
  });
});

describe("toPaise", () => {
  it("bridges pg's text BIGINT to an exact integer", () => {
    expect(toPaise("1500000")).toBe(1500000);
  });

  it("reads a null sum (no rows) as zero, never NaN", () => {
    expect(toPaise(null)).toBe(0);
  });

  it("stays exact at a scale far beyond a hospital's lifetime revenue", () => {
    // ₹5 crore over 3.3 years was the old Access file; this is 1000x that, in paise.
    expect(toPaise("500000000000")).toBe(500000000000);
    expect(Number.isSafeInteger(toPaise("500000000000"))).toBe(true);
  });
});
