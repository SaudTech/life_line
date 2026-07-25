import { describe, it, expect } from "vitest";
import {
  shapeDailyReport,
  emptyMoneyRaw,
  emptyDocumentComplianceRaw,
  BILL_TYPES,
  type DoctorShareRow,
  type MoneyRaw,
  type PendingDocumentRow,
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

// The consultation split: collections − per-doctor shares = hospital share. The
// shares arrive pre-summed per doctor (the repository applies the one tested rule,
// lib/doctors/share.ts); the shaper's job is the remainder - and keeping the split
// OUT of money-in, because the doctors' cut is still physically in the drawer.
describe("shapeDailyReport consultation split", () => {
  const doctorShare = (over: Partial<DoctorShareRow>): DoctorShareRow => ({
    doctorId: "1",
    doctorName: "Dr. Anita Rao",
    shareType: "percentage",
    sharePercentage: 40,
    shareFlatPaise: 0,
    count: 1,
    sharePaise: 0,
    ...over,
  });

  it("deducts each doctor's share and leaves the hospital the remainder", () => {
    // The stated case: ₹10,000 of consultations, doctors on 40% → hospital keeps ₹6,000.
    const money: MoneyRaw = {
      ...emptyMoneyRaw(),
      billsByType: [{ key: "consultation", count: 4, totalPaise: 1000000 }],
      billsByMode: [{ key: "cash", count: 4, totalPaise: 1000000 }],
      doctorShares: [
        doctorShare({ doctorId: "1", count: 3, sharePaise: 300000 }),
        doctorShare({ doctorId: "2", doctorName: "Dr. Suresh Kumar", count: 1, sharePaise: 100000 }),
      ],
    };
    const r = shapeDailyReport([], money);

    expect(r.consultationCollected).toEqual({ count: 4, totalPaise: 1000000 });
    expect(r.doctorShareTotalPaise).toBe(400000);
    expect(r.hospitalShareTotalPaise).toBe(600000);
    // Informational only - money in is untouched by the split.
    expect(r.moneyInTotalPaise).toBe(1000000);
  });

  it("with no shares configured, the hospital share IS the consultation total", () => {
    // Also covers legacy bills with no consultation link: they contribute
    // collections but no share row, and stay wholly with the hospital.
    const money: MoneyRaw = {
      ...emptyMoneyRaw(),
      billsByType: [{ key: "consultation", count: 2, totalPaise: 50000 }],
      billsByMode: [{ key: "cash", count: 2, totalPaise: 50000 }],
    };
    const r = shapeDailyReport([], money);

    expect(r.doctorShares).toEqual([]);
    expect(r.doctorShareTotalPaise).toBe(0);
    expect(r.hospitalShareTotalPaise).toBe(50000);
  });

  it("a day with no consultations has an all-zero split", () => {
    const money: MoneyRaw = {
      ...emptyMoneyRaw(),
      billsByType: [{ key: "procedure", count: 1, totalPaise: 40000 }],
      billsByMode: [{ key: "upi", count: 1, totalPaise: 40000 }],
    };
    const r = shapeDailyReport([], money);

    expect(r.consultationCollected).toEqual({ count: 0, totalPaise: 0 });
    expect(r.doctorShareTotalPaise).toBe(0);
    expect(r.hospitalShareTotalPaise).toBe(0);
  });
});

// Money in = bills collected + advances taken, both already net of refunds. This is
// the figure that must equal what the admin dashboard reports for the same day
// (lib/money-in.ts). The bug these defend: advances were listed separately AND left
// inside the IP bill's total, so any attempt to reconcile the drawer double-counted
// every deposit.
describe("shapeDailyReport money-in reconciliation", () => {
  it("adds advances to collected bills for the drawer total", () => {
    const money: MoneyRaw = {
      ...emptyMoneyRaw(),
      billsByMode: [{ key: "cash", count: 3, totalPaise: 500000 }],
      advancesByMode: [{ key: "cash", count: 1, totalPaise: 1000000 }],
    };
    const r = shapeDailyReport([], money);

    expect(r.collectedTotalPaise).toBe(500000); // bills only
    expect(r.advancesTotalPaise).toBe(1000000); // deposits only
    expect(r.moneyInTotalPaise).toBe(1500000); // what the till holds
  });

  it("money in equals collected when no advances were taken", () => {
    const money: MoneyRaw = {
      ...emptyMoneyRaw(),
      billsByMode: [{ key: "upi", count: 2, totalPaise: 320000 }],
    };
    const r = shapeDailyReport([], money);
    expect(r.moneyInTotalPaise).toBe(r.collectedTotalPaise);
  });

  it("subtracts refunds exactly once - the by-mode lines are gross of them", () => {
    // The repository sums billCollectedSql (money TAKEN), so a refund is not netted out
    // upstream any more: this shaper is the single place it leaves the drawer.
    const money: MoneyRaw = {
      ...emptyMoneyRaw(),
      billsByMode: [{ key: "cash", count: 1, totalPaise: 100000 }],
      refunds: { count: 1, totalPaise: 400000 },
    };
    const r = shapeDailyReport([], money);

    expect(r.collectedTotalPaise).toBe(100000); // gross - what was taken
    expect(r.refunds).toEqual({ count: 1, totalPaise: 400000 });
    expect(r.moneyInTotalPaise).toBe(-300000); // 1,000 in, 4,000 back out
  });

  it("reconciles a stay: advance in, refund back out, net = the bill", () => {
    // The real 14 Jul case that exposed the old decomposition. Billed ₹18,000 against a
    // ₹20,000 advance, both on one clinic day: ₹0 collected at discharge, ₹20,000 in,
    // ₹2,000 back out. Money in must be the ₹18,000 the hospital actually kept.
    const money: MoneyRaw = {
      ...emptyMoneyRaw(),
      billsByType: [{ key: "ip", count: 1, totalPaise: 0 }], // balance due, not gross
      billsByMode: [{ key: "cash", count: 1, totalPaise: 0 }],
      advancesByMode: [{ key: "cash", count: 1, totalPaise: 2000000 }],
      refunds: { count: 1, totalPaise: 200000 },
    };
    const r = shapeDailyReport([], money);

    expect(r.advancesTotalPaise).toBe(2000000);
    expect(r.refunds.totalPaise).toBe(200000);
    expect(r.moneyInTotalPaise).toBe(1800000); // exactly the ₹18,000 bill
  });

  it("a day whose ONLY event was a refund is not empty", () => {
    // Cash left the drawer. A sheet claiming "nothing happened" would hide it (§4).
    const r = shapeDailyReport([], { ...emptyMoneyRaw(), refunds: { count: 1, totalPaise: 400000 } });
    expect(r.isEmpty).toBe(false);
  });

  it("an empty day reports zero money in and no refunds", () => {
    const r = shapeDailyReport([], emptyMoneyRaw());
    expect(r.moneyInTotalPaise).toBe(0);
    expect(r.refunds).toEqual({ count: 0, totalPaise: 0 });
  });
});

// Document upload compliance: the report calls out the records the subject
// produced that STILL have no scanned documents - "100 consultations, 3 IP
// discharges, but only 90 + 2 uploaded → 10 consultations and 1 IP pending".
// The shaper's only arithmetic here is the withDocuments remainder; totals and
// pending lists come from the repository as-is.
describe("shapeDailyReport document uploads", () => {
  const pending = (recordId: string): PendingDocumentRow => ({
    recordId,
    patientName: "Asha Devi",
    patientCode: "LL000123",
  });

  it("reports withDocuments as total minus pending, per kind, plus the combined pending count", () => {
    // The stated case, scaled down: 5 consultations / 2 uploaded, 3 IP / 2 uploaded.
    const r = shapeDailyReport([], emptyMoneyRaw(), {
      opd: { total: 5, pending: [pending("11"), pending("12"), pending("13")] },
      ipd: { total: 3, pending: [pending("7")] },
    });

    expect(r.documents.opd).toMatchObject({ total: 5, withDocuments: 2 });
    expect(r.documents.opd.pending.map((p) => p.recordId)).toEqual(["11", "12", "13"]);
    expect(r.documents.ipd).toMatchObject({ total: 3, withDocuments: 2 });
    expect(r.documents.pendingTotal).toBe(4);
  });

  it("a fully-uploaded day has zero pending everywhere", () => {
    const r = shapeDailyReport([], emptyMoneyRaw(), {
      opd: { total: 4, pending: [] },
      ipd: { total: 1, pending: [] },
    });

    expect(r.documents.opd).toEqual({ total: 4, withDocuments: 4, pending: [] });
    expect(r.documents.ipd).toEqual({ total: 1, withDocuments: 1, pending: [] });
    expect(r.documents.pendingTotal).toBe(0);
  });

  it("callers that pass no compliance block get an all-zero one (the PDF path)", () => {
    const r = shapeDailyReport([], emptyMoneyRaw());
    expect(r.documents.opd).toEqual({ total: 0, withDocuments: 0, pending: [] });
    expect(r.documents.ipd).toEqual({ total: 0, withDocuments: 0, pending: [] });
    expect(r.documents.pendingTotal).toBe(0);
  });

  it("clamps withDocuments at zero if pending ever exceeds total (query race)", () => {
    const r = shapeDailyReport([], emptyMoneyRaw(), {
      ...emptyDocumentComplianceRaw(),
      opd: { total: 1, pending: [pending("1"), pending("2")] },
    });
    expect(r.documents.opd.withDocuments).toBe(0); // never "-1 with documents"
  });
});
