import { logActivity } from "@/lib/audit";
import { SERVICE_RETENTION_DAYS } from "./schema";
import { purgeExpiredServices } from "./repository";

// Permanently deletes services whose Trash retention window has passed, and audits
// each removal. This is the automatic side of the "deactivate → auto-delete in 7
// days" behaviour. It is a SYSTEM action (no human actor), so it logs with a null
// actor; the deleted service's name is kept in `details` so a trace survives even
// though the row is gone (DEVELOPMENT_RULES §4).
//
// Driven from two places (both safe to run repeatedly - the purge is transactional
// and idempotent): the daily interval in instrumentation.ts (so expiry happens even
// if nobody opens the page) and the Services page load (so an admin always sees a
// current list). Best-effort: a failure here must never break page render or boot.
export async function sweepExpiredServices(): Promise<number> {
  try {
    const deleted = await purgeExpiredServices(SERVICE_RETENTION_DAYS);
    for (const s of deleted) {
      await logActivity({
        actorId: null,
        action: "service.delete",
        entity: "service",
        targetId: s.id,
        details: { name: s.name, reason: "trash_retention_expired" },
      });
    }
    return deleted.length;
  } catch (err) {
    console.error("[services] sweep of expired trash failed:", err);
    return 0;
  }
}
