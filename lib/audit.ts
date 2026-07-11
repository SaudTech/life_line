import { pool } from "@/lib/db";
import type { ActivityAction } from "@/lib/activity/actions";

// The one helper that writes to the app-wide activity log (audit_log). Append-only
// (DEVELOPMENT_RULES §4/§8): every meaningful mutation records who did what, to
// what, where, and when. Server-only - imported by server actions.
//
// `action` is the typed ActivityAction union (lib/activity/actions.ts), so a
// mistyped tag is a compile error, never a bad row. `target_id` is TEXT and holds
// a UUID (users) or a bigint id (doctors, bills, …) uniformly (migration 0003).
//
// SECURITY: never put a secret in `details` - no password, PIN, or any hash.
//
// Best-effort: a logging failure must NOT fail or roll back the real action it
// records (that action has already succeeded). We swallow and console.error.
export async function logActivity(input: {
  actorId: string | null; // user_id of the actor; null for system / pre-auth
  action: ActivityAction; // canonical tag - typed, so typos fail to compile
  entity: string; // target type: "user" | "doctor" | "patient" | "bill" | ...
  targetId?: string | null; // the target's id as text (UUID or bigint); null if n/a
  locationId?: string | null; // branch (bigint as string); null for system/pre-auth
  details?: Record<string, unknown>; // extra context - NEVER secrets
}): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO audit_log (user_id, action, entity, target_id, location_id, details)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        input.actorId,
        input.action,
        input.entity,
        input.targetId ?? null,
        input.locationId ?? null,
        input.details ?? null,
      ],
    );
  } catch (err) {
    // The mutation being recorded already succeeded; losing its log entry must
    // not surface as a failure to the user. Record it where an operator can see.
    console.error(`[activity] failed to log "${input.action}":`, err);
  }
}
