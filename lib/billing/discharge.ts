// Pure, tested discharge-balance rule (DEVELOPMENT_RULES §1/§2 - the single
// source of truth the rules name: calculateDischargeBalance). No DB, no I/O. All
// amounts are INTEGER paise (minor units) - never a float rupee. The in-patient
// discharge total is (room + Σ expenses) − discount, settled against the advance:
// the result is EITHER a payable balance OR a refund - never silently dropped
// (PROJECT_OVERVIEW §In-Patient). The UI never re-derives this; it asks the
// server, which asks this.

export interface DischargeBalanceInput {
  roomChargePaise: number;
  expenses: { totalPaise: number }[];
  advancePaise: number;
  // Already resolved (pct/amount → paise) by resolveDiscountPaise, and only ever
  // non-zero when a supervisor approved it (enforced upstream by canFinalizeBill).
  discountPaise: number;
}

export interface DischargeBalance {
  subtotalPaise: number; // room + Σ expenses
  discountPaise: number; // clamped ≤ subtotal
  totalPaise: number; // subtotal − discount
  advancePaise: number;
  balanceDuePaise: number; // max(0, total − advance) - what the patient still owes
  refundPaise: number; // max(0, advance − total) - what must be handed back
}

// Compute the discharge settlement from authoritative paise values. Integer
// paise only; every input is asserted a non-negative integer so a stray float or
// NaN can never silently corrupt a total (§4). The discount is clamped to the
// subtotal (a discount can never exceed the bill), so the total is always ≥ 0,
// and exactly one of balanceDue / refund is non-zero (they can both be 0 when the
// advance settles the total exactly).
export function calculateDischargeBalance(input: DischargeBalanceInput): DischargeBalance {
  assertNonNegInt(input.roomChargePaise, "roomChargePaise");
  assertNonNegInt(input.advancePaise, "advancePaise");
  assertNonNegInt(input.discountPaise, "discountPaise");

  let subtotalPaise = input.roomChargePaise;
  for (const e of input.expenses) {
    assertNonNegInt(e.totalPaise, "expense.totalPaise");
    subtotalPaise += e.totalPaise;
  }

  const discountPaise = Math.min(input.discountPaise, subtotalPaise);
  const totalPaise = subtotalPaise - discountPaise;

  const balanceDuePaise = Math.max(0, totalPaise - input.advancePaise);
  const refundPaise = Math.max(0, input.advancePaise - totalPaise);

  return {
    subtotalPaise,
    discountPaise,
    totalPaise,
    advancePaise: input.advancePaise,
    balanceDuePaise,
    refundPaise,
  };
}

function assertNonNegInt(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer paise value, got: ${value}`);
  }
}
