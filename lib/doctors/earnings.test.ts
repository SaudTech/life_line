import { describe, expect, it } from "vitest";
import {
  rateLineKey,
  shapeDoctorEarnings,
  type DoctorEarningRateRow,
  type DoctorPayoutRow,
} from "./earnings";

// The doctor-earnings shaper (the sheet handed to a doctor at the counter). Money is
// integer paise and every total is computed HERE, so these tests are the guarantee
// that the sheet's arithmetic is right before it is ever rendered - including the
// paid/payable split, which is the only thing standing between a busy counter and
// paying the same shift twice.

const row = (over: Partial<DoctorEarningRateRow> = {}): DoctorEarningRateRow => ({
  doctorId: "1",
  doctorName: "Dr Khalid",
  department: "General Medicine",
  shareType: "percentage",
  sharePercentage: 40,
  shareFlatPaise: null,
  count: 1,
  collectedPaise: 100000,
  sharePaise: 40000,
  ...over,
});

const payout = (over: Partial<DoctorPayoutRow> = {}): DoctorPayoutRow => ({
  doctorId: "1",
  payoutId: "p1",
  paidByName: "Priya Menon",
  paidAtLabel: "6 Aug 2026, 2:04 pm",
  count: 1,
  paise: 40000,
  ...over,
});

const labels = new Map<string, string>([
  ["1:percentage:40:", "40%"],
  ["1:percentage:50:", "50%"],
  ["1:flat::50000", "₹500.00 flat"],
  ["2:percentage:30:", "30%"],
]);

describe("shapeDoctorEarnings", () => {
  it("combines a doctor's work regardless of which desk billed it", () => {
    // THE case this sheet exists for: OP Desk 1 billed 4 of Dr Khalid's
    // consultations and OP Desk 2 billed 9. `created_by` is not in the query, so the
    // repository returns ONE group of 13 and the doctor is paid once, for all of it.
    const out = shapeDoctorEarnings(
      [row({ count: 13, collectedPaise: 1300000, sharePaise: 520000 })],
      [],
      labels,
    );
    expect(out.doctors).toHaveLength(1);
    expect(out.doctors[0].count).toBe(13);
    expect(out.doctors[0].sharePaise).toBe(520000);
    expect(out.totalCount).toBe(13);
  });

  it("with nothing settled, everything is payable", () => {
    const out = shapeDoctorEarnings(
      [row({ count: 13, collectedPaise: 1300000, sharePaise: 520000 })],
      [],
      labels,
    );
    const d = out.doctors[0];
    expect(d.paidCount).toBe(0);
    expect(d.paidPaise).toBe(0);
    expect(d.payableCount).toBe(13);
    expect(d.payablePaise).toBe(520000);
    expect(d.isFullySettled).toBe(false);
    expect(out.hasPaid).toBe(false);
  });

  it("keeps two doctors apart and totals them", () => {
    const out = shapeDoctorEarnings(
      [
        row({ count: 13, collectedPaise: 1300000, sharePaise: 520000 }),
        row({
          doctorId: "2",
          doctorName: "Dr Anand",
          department: "Paediatrics",
          sharePercentage: 30,
          count: 5,
          collectedPaise: 500000,
          sharePaise: 150000,
        }),
      ],
      [],
      labels,
    );
    expect(out.doctors.map((d) => d.doctorName)).toEqual(["Dr Khalid", "Dr Anand"]);
    expect(out.totalCount).toBe(18);
    expect(out.totalCollectedPaise).toBe(1800000);
    expect(out.totalSharePaise).toBe(670000);
    expect(out.totalPayablePaise).toBe(670000);
  });

  it("a rate changed mid-window becomes TWO rate lines under one doctor", () => {
    // The stated case: 40% until 18:00, 50% after. The frozen shares are summed for
    // the payout, and the sheet can still show which bills were priced which way -
    // it never averages two deals into one invented rate.
    const out = shapeDoctorEarnings(
      [
        row({ sharePercentage: 40, count: 4, collectedPaise: 400000, sharePaise: 160000 }),
        row({ sharePercentage: 50, count: 6, collectedPaise: 600000, sharePaise: 300000 }),
      ],
      [],
      labels,
    );
    expect(out.doctors).toHaveLength(1);
    const d = out.doctors[0];
    expect(d.count).toBe(10);
    expect(d.sharePaise).toBe(460000);
    expect(d.rates.map((r) => r.rateLabel)).toEqual(["40%", "50%"]);
    expect(out.hasMixedRates).toBe(true);
  });

  it("a percentage and a flat rate are different lines, not the same one", () => {
    const out = shapeDoctorEarnings(
      [
        row({ sharePercentage: 40, count: 2, collectedPaise: 200000, sharePaise: 80000 }),
        row({
          shareType: "flat",
          sharePercentage: null,
          shareFlatPaise: 50000,
          count: 3,
          collectedPaise: 300000,
          sharePaise: 150000,
        }),
      ],
      [],
      labels,
    );
    expect(out.doctors[0].rates.map((r) => r.rateLabel)).toEqual(["40%", "₹500.00 flat"]);
    expect(out.doctors[0].sharePaise).toBe(230000);
  });

  it("a single rate is not flagged as mixed", () => {
    const out = shapeDoctorEarnings([row()], [], labels);
    expect(out.hasMixedRates).toBe(false);
    expect(out.doctors[0].rates).toHaveLength(1);
  });

  it("a group with no recorded rate says so instead of inventing 0%", () => {
    // Legacy bills from before migration 0025 carry an amount but never recorded the
    // rate that produced it. Printing "0%" beside a real payout would be a lie.
    const out = shapeDoctorEarnings(
      [row({ shareType: null, sharePercentage: null, shareFlatPaise: null })],
      [],
      labels,
    );
    expect(out.doctors[0].rates[0].rateLabel).toBe("rate not recorded");
  });

  it("an empty window is empty, with zero totals and no NaN", () => {
    const out = shapeDoctorEarnings([], [], labels);
    expect(out.isEmpty).toBe(true);
    expect(out.doctors).toEqual([]);
    expect(out.totalCount).toBe(0);
    expect(out.totalCollectedPaise).toBe(0);
    expect(out.totalSharePaise).toBe(0);
    expect(out.totalPaidPaise).toBe(0);
    expect(out.totalPayablePaise).toBe(0);
    expect(out.hasMixedRates).toBe(false);
    expect(out.hasPaid).toBe(false);
  });

  it("a doctor on 0% appears with a zero cut rather than vanishing", () => {
    // Vanishing would read as "no consultations", which is a different statement
    // and the wrong one to make to a doctor who worked.
    const out = shapeDoctorEarnings(
      [row({ sharePercentage: 0, count: 3, collectedPaise: 300000, sharePaise: 0 })],
      [],
      new Map([["1:percentage:0:", "0%"]]),
    );
    expect(out.doctors[0].count).toBe(3);
    expect(out.doctors[0].sharePaise).toBe(0);
    expect(out.isEmpty).toBe(false);
  });
});

// ── Settlement (migration 0026) ───────────────────────────────────────────────
describe("shapeDoctorEarnings - paid vs payable", () => {
  it("subtracts an earlier payout, leaving only what is still owed", () => {
    // The 12:00-14:00 sitting (4 consultations) was settled at 2pm. Someone opens the
    // WHOLE day at 8pm and sees all 13 - the payable figure must be the other 9.
    const out = shapeDoctorEarnings(
      [row({ count: 13, collectedPaise: 1300000, sharePaise: 520000 })],
      [payout({ count: 4, paise: 160000 })],
      labels,
    );
    const d = out.doctors[0];
    expect(d.sharePaise).toBe(520000);
    expect(d.paidCount).toBe(4);
    expect(d.paidPaise).toBe(160000);
    expect(d.payableCount).toBe(9);
    expect(d.payablePaise).toBe(360000);
    expect(d.isFullySettled).toBe(false);
    expect(out.hasPaid).toBe(true);
  });

  it("names WHO settled it and when, so the next person can check", () => {
    const out = shapeDoctorEarnings(
      [row({ count: 13, sharePaise: 520000 })],
      [payout({ count: 4, paise: 160000, paidByName: "Priya Menon" })],
      labels,
    );
    expect(out.doctors[0].payouts).toHaveLength(1);
    expect(out.doctors[0].payouts[0].paidByName).toBe("Priya Menon");
    expect(out.doctors[0].payouts[0].paidAtLabel).toBe("6 Aug 2026, 2:04 pm");
  });

  it("a window covered by SEVERAL payouts sums them and lists each", () => {
    // Morning settled at 2pm by one desk, evening at 8pm by another; now someone is
    // looking at the whole day. Both must show, or the sheet claims a single payer.
    const out = shapeDoctorEarnings(
      [row({ count: 13, sharePaise: 520000 })],
      [
        payout({ payoutId: "p1", count: 4, paise: 160000, paidByName: "Priya Menon" }),
        payout({ payoutId: "p2", count: 5, paise: 200000, paidByName: "Saud" }),
      ],
      labels,
    );
    const d = out.doctors[0];
    expect(d.payouts).toHaveLength(2);
    expect(d.paidCount).toBe(9);
    expect(d.paidPaise).toBe(360000);
    expect(d.payableCount).toBe(4);
    expect(d.payablePaise).toBe(160000);
  });

  it("a fully settled window is flagged, with nothing left payable", () => {
    const out = shapeDoctorEarnings(
      [row({ count: 4, collectedPaise: 400000, sharePaise: 160000 })],
      [payout({ count: 4, paise: 160000 })],
      labels,
    );
    const d = out.doctors[0];
    expect(d.isFullySettled).toBe(true);
    expect(d.payableCount).toBe(0);
    expect(d.payablePaise).toBe(0);
    expect(out.totalPayablePaise).toBe(0);
    // Still not "empty" - the work exists and the sheet must show it was paid, not
    // pretend the doctor did nothing.
    expect(out.isEmpty).toBe(false);
  });

  it("a payout for a doctor with no work in this window is ignored", () => {
    // It belongs to some other window. Attaching it would put a stranger's payment
    // on this slip and make the payable figure wrong.
    const out = shapeDoctorEarnings(
      [row({ count: 4, sharePaise: 160000 })],
      [payout({ doctorId: "99", count: 3, paise: 120000 })],
      labels,
    );
    expect(out.doctors[0].paidCount).toBe(0);
    expect(out.doctors[0].payablePaise).toBe(160000);
    expect(out.hasPaid).toBe(false);
  });

  it("payouts land on the right doctor when several are shown", () => {
    const out = shapeDoctorEarnings(
      [
        row({ count: 4, sharePaise: 160000 }),
        row({ doctorId: "2", doctorName: "Dr Anand", sharePercentage: 30, count: 5, sharePaise: 150000 }),
      ],
      [payout({ doctorId: "2", count: 5, paise: 150000 })],
      labels,
    );
    const [khalid, anand] = out.doctors;
    expect(khalid.paidCount).toBe(0);
    expect(khalid.payablePaise).toBe(160000);
    expect(anand.isFullySettled).toBe(true);
    expect(anand.payablePaise).toBe(0);
    expect(out.totalPayablePaise).toBe(160000);
    expect(out.totalPaidPaise).toBe(150000);
  });

  it("totals split three ways and always reconcile", () => {
    const out = shapeDoctorEarnings(
      [
        row({ count: 13, collectedPaise: 1300000, sharePaise: 520000 }),
        row({ doctorId: "2", doctorName: "Dr Anand", sharePercentage: 30, count: 5, collectedPaise: 500000, sharePaise: 150000 }),
      ],
      [payout({ count: 4, paise: 160000 }), payout({ doctorId: "2", payoutId: "p2", count: 2, paise: 60000 })],
      labels,
    );
    expect(out.totalSharePaise).toBe(670000);
    expect(out.totalPaidPaise).toBe(220000);
    expect(out.totalPayablePaise).toBe(450000);
    // The invariant the sheet rests on: paid + payable = what the window is worth.
    expect(out.totalPaidPaise + out.totalPayablePaise).toBe(out.totalSharePaise);
    expect(out.totalPaidCount + out.totalPayableCount).toBe(out.totalCount);
  });

  it("never prints a negative amount still owed", () => {
    // Cannot happen by construction (a payout only covers bills inside the window),
    // but a payout sheet showing "-₹400 still owed" would be worse than any bug.
    const out = shapeDoctorEarnings(
      [row({ count: 1, sharePaise: 40000 })],
      [payout({ count: 5, paise: 200000 })],
      labels,
    );
    expect(out.doctors[0].payablePaise).toBe(0);
    expect(out.doctors[0].payableCount).toBe(0);
    expect(out.totalPayablePaise).toBe(0);
  });
});

describe("rateLineKey", () => {
  it("is stable for the same rate and distinct across rates", () => {
    expect(rateLineKey(row({ sharePercentage: 40 }))).toBe(rateLineKey(row({ sharePercentage: 40 })));
    expect(rateLineKey(row({ sharePercentage: 40 }))).not.toBe(
      rateLineKey(row({ sharePercentage: 50 })),
    );
  });

  it("separates the same number expressed as a percentage and as a flat amount", () => {
    const asPct = rateLineKey(row({ shareType: "percentage", sharePercentage: 500, shareFlatPaise: null }));
    const asFlat = rateLineKey(row({ shareType: "flat", sharePercentage: null, shareFlatPaise: 500 }));
    expect(asPct).not.toBe(asFlat);
  });

  it("separates two doctors on the same rate", () => {
    expect(rateLineKey(row({ doctorId: "1" }))).not.toBe(rateLineKey(row({ doctorId: "2" })));
  });
});
