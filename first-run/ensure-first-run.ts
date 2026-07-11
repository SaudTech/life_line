import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { hashPassword } from "@/lib/password";

// First-run setup: guarantee the system is usable the moment it starts.
// Ensures (1) a base location exists, and (2) at least one admin user exists -
// so there is never a running app that nobody can log into.
//
// Idempotent: once an admin exists, this does nothing. Called once at server
// startup from instrumentation.ts. It must NOT throw - a setup problem
// (e.g. migrations not yet applied) should be logged, not crash the server.

// Arbitrary constant key so concurrent starts serialise on the same lock
// instead of racing to insert two admins.
const FIRST_RUN_LOCK_KEY = 918_273;

export async function ensureFirstRun(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [FIRST_RUN_LOCK_KEY]);

    // 1. Ensure a location exists (every user needs a location_id).
    const locationName = process.env.FIRST_RUN_LOCATION_NAME?.trim() || "Life Line Hospital";
    let locationId: number;
    const existingLocation = await client.query<{ id: string }>(
      "SELECT id FROM locations ORDER BY id LIMIT 1",
    );
    if (existingLocation.rows.length > 0) {
      locationId = Number(existingLocation.rows[0].id);
    } else {
      const inserted = await client.query<{ id: string }>(
        "INSERT INTO locations (name) VALUES ($1) RETURNING id",
        [locationName],
      );
      locationId = Number(inserted.rows[0].id);
      console.log(`[first-run] created location "${locationName}" (id ${locationId}).`);
    }

    // 2. Ensure an admin exists.
    const existingAdmin = await client.query(
      "SELECT 1 FROM users WHERE role = 'admin' LIMIT 1",
    );
    if (existingAdmin.rows.length > 0) {
      await client.query("COMMIT");
      return;
    }

    // Staff sign in with their phone number (see migration 0002).
    const phone = process.env.FIRST_RUN_ADMIN_PHONE?.trim() || "0000000000";
    const envPassword = process.env.FIRST_RUN_ADMIN_PASSWORD;
    // If no password is configured, generate a strong random one and print it
    // ONCE - never fall back to a guessable default like "admin/admin".
    const generated = !envPassword;
    const password = envPassword || randomBytes(9).toString("base64url");

    const passwordHash = await hashPassword(password);
    const createdAdmin = await client.query<{ id: string }>(
      `INSERT INTO users (name, phone, password_hash, role, location_id)
       VALUES ($1, $2, $3, 'admin', $4)
       RETURNING id`,
      ["Administrator", phone, passwordHash, locationId],
    );

    // Record the bootstrap in the app-wide activity log - a system event, so the
    // actor (user_id) is NULL. Written in the same transaction as the admin so the
    // two commit together. Canonical tag: system.first_run_admin.
    await client.query(
      `INSERT INTO audit_log (user_id, action, entity, target_id, location_id)
       VALUES (NULL, 'system.first_run_admin', 'user', $1, $2)`,
      [createdAdmin.rows[0].id, locationId],
    );
    await client.query("COMMIT");

    console.log(
      `\n[first-run] Created initial admin user - phone: "${phone}"`,
    );
    if (generated) {
      console.log(
        `[first-run] Generated password: ${password}\n` +
          `[first-run] ⚠ Save this now and change it after first login. It will not be shown again.\n`,
      );
    } else {
      console.log(`[first-run] Password taken from FIRST_RUN_ADMIN_PASSWORD.\n`);
    }
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    const message = err instanceof Error ? err.message : String(err);
    // undefined_table → migrations haven't been applied yet.
    if (message.includes("does not exist")) {
      console.error(
        `[first-run] Skipped - database not migrated yet. Run \`npm run migrate\`, then restart.`,
      );
    } else {
      console.error(`[first-run] Failed (server still starting): ${message}`);
    }
  } finally {
    client.release();
  }
}
