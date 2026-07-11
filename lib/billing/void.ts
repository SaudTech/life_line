// Pure, tested rules for bill correction - void + re-issue (DEVELOPMENT_RULES
// §1/§4: one source of truth per rule, no DB, no side effects). "Nothing is
// hard-deleted - corrections are void + re-issue with an audit trail." These
// functions decide WHETHER a bill may be voided and WHAT happens to a voided
// consultation's validity; the action asks these, the SQL guards mirror them.

import { addDays } from "@/lib/consultations/rules";
import type { IsoDay } from "@/lib/consultations/rules";

export type BillStatus = "final" | "pending_approval" | "void";

// Only a FINALIZED bill can be voided. A bill that is already void (or not yet
// final) can never be voided again - the correction path is void-ONCE, then
// re-issue a corrected bill. The repository's SQL guard (status = 'final')
// mirrors this so a stale tab or a double-click is a harmless no-op, never a
// second void.
export function canVoidBill(status: BillStatus): boolean {
  return status === "final";
}

// When a CONSULTATION bill is voided, its consultation must stop granting free
// revisits at once - a revisit must never ride on a voided consultation. Setting
// valid_until to the day BEFORE the clinic's today blocks even a same-day
// revisit, because isConsultationValid is inclusive of valid_until (a visit "on
// or before valid_until" is still covered). Pure so the boundary is unit-tested.
export function consultationExpiryOnVoid(today: IsoDay): IsoDay {
  return addDays(today, -1);
}
