import { verifyPassword } from "@/lib/password";
import { listDiscountApprovers } from "@/lib/users/repository";
import { rupeesToPaise } from "@/lib/money";
import { logActivity } from "@/lib/audit";
import { computeDiscountPaise, clampDiscountPaise } from "./rules";

// Shared discount-authorization helpers (moved from consultations/actions.ts so
// procedures can reuse them without duplicating the PIN-check / resolution
// logic - DEVELOPMENT_RULES §2, one source of truth per rule). Server-only.

// Try each supervisor/admin PIN hash; return the matching user or null. scrypt
// is salted per row, so a PIN can't be looked up directly - every active
// approver's hash is tried.
//
// SECURITY: `locationId` is REQUIRED, and scopes the candidate approvers to the branch
// the bill belongs to (§8, enforced on the server). Without it, any supervisor PIN in
// the company authorized a discount at any branch - an approval is a money decision
// about one location's bill, so only that location's supervisors may make it. It is a
// parameter rather than a default so a new call site cannot forget it: leaving it out
// is a compile error, not a silent cross-branch grant.
export async function findApproverByPin(
  pin: string,
  locationId: string,
): Promise<{ id: string; name: string } | null> {
  const approvers = await listDiscountApprovers(locationId);
  for (const a of approvers) {
    if (await verifyPassword(pin, a.pin_hash)) return { id: a.id, name: a.name };
  }
  return null;
}

// Record a failed supervisor-PIN attempt in the activity log - one row per wrong/
// unknown PIN, from every discount call site (consultation or procedure). Shared
// so all sites log identically (DEVELOPMENT_RULES §2, one source of truth).
// SECURITY: the PIN and its hash are NEVER logged - only the flow it happened in.
// Best-effort: logActivity swallows its own errors, so this can never break the
// billing action it accompanies.
export async function logFailedPinAttempt(input: {
  actorId: string | null;
  locationId: string | null;
  context: "consultation" | "procedure" | "void" | "discharge";
}): Promise<void> {
  await logActivity({
    actorId: input.actorId,
    action: "discount.pin_failed",
    entity: "bill",
    locationId: input.locationId,
    details: { context: input.context },
  });
}

// Resolve a discount to integer paise from EITHER a percentage OR a flat rupee
// amount (percent wins if both are given). All the money math lives in the pure
// billing rules; this is the one place the two discount inputs are interpreted.
export function resolveDiscountPaise(
  subtotalPaise: number,
  opts: { pct?: number; amount?: string },
): number {
  if (opts.pct && opts.pct > 0) return computeDiscountPaise(subtotalPaise, opts.pct);
  if (opts.amount && opts.amount !== "") {
    return clampDiscountPaise(subtotalPaise, rupeesToPaise(opts.amount));
  }
  return 0;
}
