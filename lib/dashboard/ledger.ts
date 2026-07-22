// PURE, tested display rules for the admin's money ledger ("Recent invoices"). No
// DB, no React: the repository reads rows, this turns each into a label + direction
// + effect, and the component only renders what it returns (DEVELOPMENT_RULES §2 -
// no logic in the UI).
//
// The ledger answers ONE question: what money came in or went out, most recent
// first. It must agree with the cards above it, so it reckons a row's effect with
// the SAME rule those cards sum (lib/money-in.ts). If you change one, change both -
// two definitions of money is the bug this whole area was fixed for.

import type { BillType } from "@/lib/money-in";

// An advance is money but never a bill row, so the ledger's kinds are the bill types
// plus it. `end_day`/`advance` template types are unrelated - this is billing data.
export type MovementKind = BillType | "advance";
export type MovementStatus = "final" | "pending_approval" | "void";

// Money moving toward the hospital, away from it, or not at all (a bill that is
// voided or not yet approved is an invoice, not a movement).
export type MovementDirection = "in" | "out" | "none";

// `grossPaise` is what the movement is WORTH, already signed by the money-in rule:
// positive for cash taken, negative for a discharge that refunded more than it billed.
// It is NOT conditioned on status - see movementEffectPaise for that.
export interface Movement {
  kind: MovementKind;
  status: MovementStatus;
  grossPaise: number;
}

// What the row is called. The IP cases are split because "In-patient -₹4,000" tells
// an admin nothing, while "Discharge refund" tells them cash left the drawer and why.
export function movementLabel(m: Movement): string {
  switch (m.kind) {
    case "consultation":
      return "Consultation";
    case "procedure":
      return "Procedure";
    case "advance":
      return "Admission advance";
    case "ip":
      if (m.grossPaise < 0) return "Discharge refund";
      // The advance covered the bill exactly: a real invoice, zero cash at the
      // counter. Saying "Discharge balance ₹0" would read like a bug.
      if (m.grossPaise === 0) return "Discharge, settled by advance";
      return "Discharge balance";
  }
}

// Which way the money went. ONLY a finalized bill moves money: a voided bill was
// reversed, and a pending_approval bill cannot finalise, so its money has not been
// collected (PROJECT_OVERVIEW §6). Both are shown - they are invoices the admin needs
// to see - but neither is counted, which is exactly how the cards above treat them.
export function movementDirection(m: Movement): MovementDirection {
  if (m.status !== "final") return "none";
  if (m.grossPaise > 0) return "in";
  if (m.grossPaise < 0) return "out";
  return "none";
}

// What this row actually contributed to the day's money-in. Zero unless finalized -
// so summing a window of the ledger reconciles with the revenue cards rather than
// quietly disagreeing with them.
export function movementEffectPaise(m: Movement): number {
  return m.status === "final" ? m.grossPaise : 0;
}

// A short note for the rows that are NOT money, so the amount beside them is never
// mistaken for cash that changed hands. Null when the row is a real movement.
export function movementNote(m: Movement): string | null {
  if (m.status === "void") return "Voided";
  if (m.status === "pending_approval") return "Pending approval";
  return null;
}
