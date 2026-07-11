// Pure, tested billing money-rules (DEVELOPMENT_RULES §1/§4). No DB, no I/O. All
// amounts are INTEGER paise (minor units) - never a float rupee. One source of
// truth per rule; the UI never re-derives a total for a "preview", it asks the
// server, which asks these.

// A discount expressed as a whole-percent of a subtotal, in paise. Rounded to the
// nearest paisa (half-up) and clamped so it can never exceed the subtotal or go
// negative - a discount must leave a payable total of at least zero.
export function computeDiscountPaise(subtotalPaise: number, percent: number): number {
  assertNonNegInt(subtotalPaise, "subtotalPaise");
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new Error(`percent must be between 0 and 100, got: ${percent}`);
  }
  if (percent === 0) return 0;
  const raw = Math.round((subtotalPaise * percent) / 100);
  return Math.min(raw, subtotalPaise);
}

// A flat (rupee-entered) discount in paise, clamped so it can never exceed the
// subtotal or go negative. Used when a clerk types a custom amount rather than a
// percentage - the amount is an operator input, not a formula, but it still must
// leave a payable total of at least zero.
export function clampDiscountPaise(subtotalPaise: number, requestedPaise: number): number {
  assertNonNegInt(subtotalPaise, "subtotalPaise");
  assertNonNegInt(requestedPaise, "requestedPaise");
  return Math.min(requestedPaise, subtotalPaise);
}

// The payable total after a discount. Guards keep the arithmetic honest: the
// discount cannot exceed the subtotal, so the total is always >= 0.
export function computeTotalPaise(subtotalPaise: number, discountPaise: number): number {
  assertNonNegInt(subtotalPaise, "subtotalPaise");
  assertNonNegInt(discountPaise, "discountPaise");
  if (discountPaise > subtotalPaise) {
    throw new Error(
      `discountPaise (${discountPaise}) cannot exceed subtotalPaise (${subtotalPaise})`,
    );
  }
  return subtotalPaise - discountPaise;
}

// A bill may only be finalized if any discount on it has a recorded approver -
// mirrors the DB constraint bills_discount_needs_approval and the rule that
// discounts require Supervisor approval (PROJECT_OVERVIEW §Billing, §Roles). A
// zero discount needs no approver.
export function canFinalizeBill(input: {
  discountPaise: number;
  approvedBy: string | null;
}): boolean {
  if (input.discountPaise < 0) return false;
  if (input.discountPaise === 0) return true;
  return input.approvedBy !== null && input.approvedBy !== "";
}

function assertNonNegInt(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer paise value, got: ${value}`);
  }
}
