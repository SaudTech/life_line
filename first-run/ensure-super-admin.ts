import type { Pool } from "pg";
import { hashPassword, verifyPassword } from "@/lib/password";
import {
  superAdminConfig,
  superAdminHalfConfigured,
  type SuperAdminConfig,
} from "@/lib/auth/super-admin";

// Self-healing super admin. Runs at every server start, right after ensureFirstRun,
// and makes the account described by SUPER_ADMIN_* in .env true again - whatever
// happened to it since the last boot:
//
//   row deleted?    recreated
//   deactivated?    reactivated
//   role changed?   forced back to admin
//   password reset? set back to the .env value
//
// That is what makes the credentials "always work no matter what": not where the
// string is stored, but the fact that a restart reasserts it. The UI is also blocked
// from breaking the account in the first place (lib/auth/super-admin-guard.ts) - this
// is the safety net behind that fence, and the only thing that can recover a row
// someone changed with psql.
//
// IDEMPOTENT AND QUIET. The common case - nothing changed since last boot - does one
// SELECT and one scrypt verify, writes nothing, and logs nothing. Rewriting the hash
// every start would churn the row (scrypt salts randomly, so the hash always differs)
// and, worse, would put a "super admin repaired" line in the audit log on every single
// restart until nobody read the audit log any more.
//
// MUST NOT THROW. Like ensureFirstRun: a setup problem is logged and the server still
// starts. A hospital that cannot bill because a convenience feature failed at boot is
// strictly worse than one with no super admin.

// Its own advisory-lock key, distinct from FIRST_RUN_LOCK_KEY, so two concurrent
// starts serialise here instead of both trying to insert the same phone.
const SUPER_ADMIN_LOCK_KEY = 918_274;

interface ExistingRow {
  id: string;
  name: string;
  password_hash: string;
  role: string;
  active: boolean;
}

export async function ensureSuperAdmin(pool: Pool): Promise<void> {
  // Half-configured is a mistake worth shouting about: somebody meant to have a super
  // admin, and finding out it silently never existed on the day you are locked out is
  // the worst possible moment.
  if (superAdminHalfConfigured()) {
    console.warn(
      "[super-admin] SUPER_ADMIN_PHONE and SUPER_ADMIN_PASSWORD must BOTH be set - " +
        "no super admin was created.",
    );
    return;
  }
  const cfg = superAdminConfig();
  if (!cfg) return; // not configured at all - a legitimate choice, stay silent

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [SUPER_ADMIN_LOCK_KEY]);

    // Every user needs a location. ensureFirstRun has already run and guarantees one
    // exists; if it somehow does not, there is nothing to attach the account to.
    const location = await client.query<{ id: string }>(
      "SELECT id FROM locations ORDER BY id LIMIT 1",
    );
    if (location.rows.length === 0) {
      await client.query("ROLLBACK");
      console.error("[super-admin] Skipped - no location exists yet.");
      return;
    }
    const locationId = Number(location.rows[0].id);

    // Matched on PHONE, the login column - unique, required, and the same field the
    // UI guard compares. Matching on name or id instead would let a rename or a
    // restore-from-backup silently create a second account.
    const existing = await client.query<ExistingRow>(
      "SELECT id, name, password_hash, role, active FROM users WHERE phone = $1",
      [cfg.phone],
    );

    if (existing.rows.length === 0) {
      await createSuperAdmin(client, cfg, locationId);
      await client.query("COMMIT");
      console.log(`[super-admin] Created super admin - phone: "${cfg.phone}".`);
      return;
    }

    const row = existing.rows[0];
    const repairs = await diffRepairs(row, cfg);
    if (repairs.length === 0) {
      await client.query("COMMIT");
      return; // healthy - the quiet, normal path
    }

    // Rewrite everything, not only the field that drifted. The account's whole job is
    // to be a known-good state, and a partial repair leaves it half-trusted.
    await client.query(
      `UPDATE users
          SET name = $1, password_hash = $2, role = 'admin', active = TRUE
        WHERE id = $3`,
      [cfg.name, await hashPassword(cfg.password), row.id],
    );
    await client.query(
      `INSERT INTO audit_log (user_id, action, entity, target_id, location_id, details)
       VALUES (NULL, 'system.super_admin_repair', 'user', $1, $2, $3)`,
      [row.id, locationId, JSON.stringify({ repaired: repairs })],
    );
    await client.query("COMMIT");
    console.log(`[super-admin] Repaired super admin (${repairs.join(", ")}).`);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("does not exist")) {
      console.error(
        "[super-admin] Skipped - database not migrated yet. Run `npm run migrate`, then restart.",
      );
    } else {
      console.error(`[super-admin] Failed (server still starting): ${message}`);
    }
  } finally {
    client.release();
  }
}

// What is wrong with the existing row, named, so the log and the audit trail say WHICH
// protection actually fired rather than a bare "repaired". Empty array = healthy.
async function diffRepairs(row: ExistingRow, cfg: SuperAdminConfig): Promise<string[]> {
  const repairs: string[] = [];
  if (!row.active) repairs.push("reactivated");
  if (row.role !== "admin") repairs.push(`role restored from ${row.role}`);
  if (row.name !== cfg.name) repairs.push("name restored");
  // Verified rather than compared: scrypt salts randomly, so the stored hash of the
  // right password never equals a freshly computed one. This is the only way to ask
  // "does the .env password still open this account" without rewriting it every boot.
  if (!(await verifyPassword(cfg.password, row.password_hash))) {
    repairs.push("password reset");
  }
  return repairs;
}

async function createSuperAdmin(
  client: { query: Pool["query"] },
  cfg: SuperAdminConfig,
  locationId: number,
): Promise<void> {
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO users (name, phone, password_hash, role, location_id, active)
     VALUES ($1, $2, $3, 'admin', $4, TRUE)
     RETURNING id`,
    [cfg.name, cfg.phone, await hashPassword(cfg.password), locationId],
  );
  // A system event, so the actor (user_id) is NULL - the same shape ensureFirstRun
  // uses for system.first_run_admin.
  await client.query(
    `INSERT INTO audit_log (user_id, action, entity, target_id, location_id)
     VALUES (NULL, 'system.super_admin_create', 'user', $1, $2)`,
    [inserted.rows[0].id, locationId],
  );
}
