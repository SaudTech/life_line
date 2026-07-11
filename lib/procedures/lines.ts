// Pure line math for procedure bills (DEVELOPMENT_RULES §1/§4 - no DB, no side
// effects). Integer paise only: unit price comes from the DB (server), quantity
// from the operator. The UI never re-derives these for a "preview" - it asks the
// server, which asks these functions.

export function computeLineTotal(unitPricePaise: number, quantity: number): number {
  if (!Number.isInteger(unitPricePaise) || unitPricePaise < 0) {
    throw new Error(`unitPricePaise must be a non-negative integer, got: ${unitPricePaise}`);
  }
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new Error("Quantity must be ≥ 1.");
  }
  return unitPricePaise * quantity;
}

export function computeSubtotal(
  lines: { unitPricePaise: number; quantity: number }[],
): number {
  return lines.reduce((sum, l) => sum + computeLineTotal(l.unitPricePaise, l.quantity), 0);
}
