import { pool } from "@/lib/db";
import { isSuperAdminPhone, superAdminConfig } from "./super-admin";

// Server-side guard: is this user id the protected super admin?
//
// Split from lib/auth/super-admin.ts so that module stays pure and unit-testable; this
// half is the one database lookup it needs. Kept as its own function rather than
// inlined into each action so all four mutation paths (update, deactivate, reset
// password, set PIN) ask the same question of the same column.
//
// WHY GUARD THE UI AT ALL, when boot repairs the account anyway. Because "it gets fixed
// on the next restart" is not the same as "it works". Deactivate the super admin at
// 11am on a busy Tuesday and the account is broken until somebody thinks to restart the
// server - which is precisely the situation it exists to rescue. The repair is the
// safety net; this is the fence.
//
// Fails CLOSED (returns false) when no super admin is configured: with nothing to
// protect, no user is protected. Also false for a vanished row - the caller's own
// "that user no longer exists" check owns that case.
export async function isSuperAdminUser(userId: string): Promise<boolean> {
  // Nothing configured → nothing protected, and no reason to hit the database.
  if (!superAdminConfig()) return false;
  const { rows } = await pool.query<{ phone: string }>(
    "SELECT phone FROM users WHERE id = $1",
    [userId],
  );
  return isSuperAdminPhone(rows[0]?.phone);
}

// The one refusal message, so every blocked path reads identically and explains the
// way out rather than just saying no.
export const SUPER_ADMIN_LOCKED =
  "This is the emergency super admin account and cannot be changed here. Edit SUPER_ADMIN_* in .env and restart the server.";
