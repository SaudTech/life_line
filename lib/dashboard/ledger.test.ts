import { describe, expect, it } from "vitest";
import {
  movementDirection,
  movementEffectPaise,
  movementLabel,
  movementNote,
  type Movement,
} from "./ledger";

// The ledger is the admin's answer to "what did the money do". These tests defend the
// two things that make it trustworthy:
//   1. It agrees with the revenue cards above it - a row only counts when it is money
//      (finalized). A voided or pending invoice is shown but contributes nothing.
//   2. A refund reads as money OUT, never as revenue.

const m = (over: Partial<Movement> = {}): Movement => ({
  kind: "consultation",
  status: "final",
  grossPaise: 30000,
  ...over,
});

describe("movementDirection", () => {
  it("a finalized positive bill is money in", () => {
    expect(movementDirection(m())).toBe("in");
  });

  it("a finalized negative discharge is money OUT (a refund)", () => {
    expect(movementDirection(m({ kind: "ip", grossPaise: -400000 }))).toBe("out");
  });

  it("an advance is money in", () => {
    expect(movementDirection(m({ kind: "advance", grossPaise: 1000000 }))).toBe("in");
  });

  it("a voided bill moved nothing, whatever it was worth", () => {
    expect(movementDirection(m({ status: "void", grossPaise: 500000 }))).toBe("none");
  });

  it("a pending-approval bill moved nothing - it cannot finalise, so it wasn't collected", () => {
    expect(movementDirection(m({ status: "pending_approval", grossPaise: 500000 }))).toBe("none");
  });

  it("a discharge fully settled by its advance moved nothing at the counter", () => {
    expect(movementDirection(m({ kind: "ip", grossPaise: 0 }))).toBe("none");
  });
});

describe("movementEffectPaise", () => {
  it("counts a finalized bill at its full worth", () => {
    expect(movementEffectPaise(m({ grossPaise: 45000 }))).toBe(45000);
  });

  it("counts a refund as negative - the day's total must fall", () => {
    expect(movementEffectPaise(m({ kind: "ip", grossPaise: -400000 }))).toBe(-400000);
  });

  it("counts a voided bill as zero, matching the revenue cards", () => {
    // The cards sum status='final' only. If this returned 500000 the ledger would
    // contradict the number directly above it.
    expect(movementEffectPaise(m({ status: "void", grossPaise: 500000 }))).toBe(0);
  });

  it("counts a pending bill as zero", () => {
    expect(movementEffectPaise(m({ status: "pending_approval", grossPaise: 500000 }))).toBe(0);
  });
});

describe("movementLabel", () => {
  it("names the ordinary bill types", () => {
    expect(movementLabel(m({ kind: "consultation" }))).toBe("Consultation");
    expect(movementLabel(m({ kind: "procedure" }))).toBe("Procedure");
    expect(movementLabel(m({ kind: "advance" }))).toBe("Admission advance");
  });

  it("splits the IP cases so an admin can read what happened", () => {
    expect(movementLabel(m({ kind: "ip", grossPaise: 500000 }))).toBe("Discharge balance");
    expect(movementLabel(m({ kind: "ip", grossPaise: -400000 }))).toBe("Discharge refund");
    expect(movementLabel(m({ kind: "ip", grossPaise: 0 }))).toBe("Discharge, settled by advance");
  });
});

describe("movementNote", () => {
  it("marks the rows that are not money, so the amount beside them can't mislead", () => {
    expect(movementNote(m({ status: "void" }))).toBe("Voided");
    expect(movementNote(m({ status: "pending_approval" }))).toBe("Pending approval");
  });

  it("leaves a real movement unannotated", () => {
    expect(movementNote(m())).toBeNull();
  });
});

// The property that keeps this panel honest: summing the ledger's effects reproduces
// what the revenue cards report for the same rows - never the gross of every invoice.
describe("the ledger reconciles with the revenue cards", () => {
  it("sums only the money that actually moved", () => {
    const rows: Movement[] = [
      m({ kind: "consultation", grossPaise: 30000 }), // +300
      m({ kind: "advance", grossPaise: 1000000 }), // +10,000
      m({ kind: "ip", grossPaise: 500000 }), // +5,000
      m({ kind: "ip", grossPaise: -400000 }), // -4,000 refund
      m({ status: "void", grossPaise: 900000 }), // ignored
      m({ status: "pending_approval", grossPaise: 700000 }), // ignored
    ];
    const total = rows.reduce((sum, r) => sum + movementEffectPaise(r), 0);
    expect(total).toBe(30000 + 1000000 + 500000 - 400000);
    // Explicitly NOT the sum of every invoice's face value.
    expect(total).not.toBe(rows.reduce((s, r) => s + r.grossPaise, 0));
  });
});
