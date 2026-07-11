"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/dal";
import { logActivity } from "@/lib/audit";
import { zodFieldErrors } from "@/lib/forms/action-result";
import type { ActionResult } from "@/lib/forms/action-result";
import { getUserLocationId } from "@/lib/users/repository";
import { findApproverByPin, logFailedPinAttempt } from "@/lib/billing/discount";
import { clinicToday } from "@/lib/date-range";
import { voidBillSchema } from "./schema";
import { consultationExpiryOnVoid } from "./void";
import { voidBill, type BillType } from "./repository";

// Server action for bill correction - VOID (plan §Part A). Type-agnostic: the
// same action voids a consultation OR a procedure bill. Voiding reverses real
// money, so it is gated on a SUPERVISOR PIN verified on the SERVER (hiding UI is
// not security, §9) - any signed-in counter user may OPEN the void dialog, but
// it only completes with a supervisor's PIN, exactly like a discount approval.
// Nothing is ever deleted; the void is recorded, audited, and reprintable.

const CONSULT_HISTORY_PATH = "/consultations/history";
const PROCEDURE_HISTORY_PATH = "/procedures/history";

export interface VoidOutcome {
  billNumber: string;
  type: BillType;
}

// Void a finalized bill. Requires a reason + a supervisor PIN. On a bad PIN the
// attempt is logged (context "void") and a field error is returned; on a bill
// that can no longer be voided (already void / not found / wrong location) a
// clear error is returned - never a silent failure, never a second void.
export async function voidBillAction(input: unknown): Promise<ActionResult<VoidOutcome>> {
  const s = await requireSession();

  const parsed = voidBillSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: zodFieldErrors(parsed.error) };
  }
  const v = parsed.data;

  const locationId = await getUserLocationId(s.sub);
  if (!locationId) {
    return {
      ok: false,
      formError: "Could not resolve your location. Please sign in again.",
    };
  }

  // Supervisor authorization - same pattern as discount approval. scrypt is
  // salted per row, so findApproverByPin tries every active approver's hash.
  const approver = await findApproverByPin(v.pin);
  if (!approver) {
    await logFailedPinAttempt({ actorId: s.sub, locationId, context: "void" });
    return { ok: false, fieldErrors: { pin: "PIN not recognised." } };
  }

  const voided = await voidBill({
    billId: v.billId,
    locationId,
    voidedBy: approver.id,
    reason: v.reason,
    consultationExpiry: consultationExpiryOnVoid(clinicToday()),
  });
  if (!voided) {
    return { ok: false, formError: "This bill can no longer be voided." };
  }

  // Audit: the actor did it, the approver authorized it. Reason is recorded for
  // the trail (never a secret - PINs/hashes are never logged).
  await logActivity({
    actorId: s.sub,
    action: "bill.void",
    entity: "bill",
    targetId: v.billId,
    locationId,
    details: {
      bill_number: voided.billNumber,
      reason: v.reason,
      approved_by: approver.id,
      approved_by_name: approver.name, // shown in the activity feed (display only)
    },
  });

  // A void can originate from either history screen; refresh both so the badge
  // + removed action show on the next server render.
  revalidatePath(CONSULT_HISTORY_PATH);
  revalidatePath(PROCEDURE_HISTORY_PATH);
  return { ok: true, data: { billNumber: voided.billNumber, type: voided.type } };
}
