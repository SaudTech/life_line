import { cache } from "react";
import { pool } from "@/lib/db";
import type { Role } from "./schema";
import type { PermissionKey } from "@/lib/permissions";

// Data access for staff accounts (plan §5). Thin: each function is one query and
// nothing more - no validation, no hashing, no business rules (those live in the
// schema and the actions). SECURITY: the hash columns (password_hash, pin_hash)
// are NEVER selected out to the app - not here, not anywhere (§10).

// The row shape sent to the UI. No hashes, by construction of the SELECT list -
// `has_pin` is a boolean derived from pin_hash IS NOT NULL, never the hash itself.
export interface UserListRow {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  role: Role;
  active: boolean;
  has_pin: boolean;
  permissions: string[];
  supervisor_id: string | null;
  supervisor_name: string | null; // resolved for display; null when unassigned
  created_at: Date;
}

// All users at ONE location (active AND inactive) - the client filters. Ordered by
// name for a stable, muscle-memory grid. `permissions` is not a secret (unlike the
// hashes), so the client can render the granted checkboxes. Location-scoped (§4): an
// admin manages their own branch's staff, and the supervisor_name join deliberately
// stays unscoped so an already-assigned cross-branch supervisor still renders a name
// rather than a blank.
export async function listUsers(locationId: string): Promise<UserListRow[]> {
  const { rows } = await pool.query<UserListRow>(
    `SELECT u.id, u.name, u.phone, u.email, u.role, u.active,
            (u.pin_hash IS NOT NULL) AS has_pin, u.permissions,
            u.supervisor_id, sup.name AS supervisor_name,
            u.created_at
       FROM users u
       LEFT JOIN users sup ON sup.id = u.supervisor_id
      WHERE u.location_id = $1
      ORDER BY u.name ASC`,
    [locationId],
  );
  return rows;
}

export interface CreateUserInput {
  name: string;
  phone: string;
  email: string | null;
  role: Role;
  password_hash: string;
  pin_hash: string | null;
  permissions: string[]; // validated against the registry by the action (plan B-4)
  supervisor_id: string | null; // validated as an active supervisor/admin by the action
  location_id: string; // bigint returned by pg as string
}

// INSERT a new staff account. The caller catches Postgres 23505 (unique
// violation) to map users_phone_unique / users_email_unique to a field error.
export async function createUser(input: CreateUserInput): Promise<{ id: string }> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (name, phone, email, role, password_hash, pin_hash, permissions, supervisor_id, location_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      input.name,
      input.phone,
      input.email,
      input.role,
      input.password_hash,
      input.pin_hash,
      input.permissions,
      input.supervisor_id,
      input.location_id,
    ],
  );
  return rows[0];
}

export interface UpdateUserInput {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  role: Role;
  permissions: string[]; // validated against the registry by the action (plan B-4)
  supervisor_id: string | null; // validated as an active supervisor/admin by the action
}

// UPDATE the editable details (never the password/PIN). Caller catches 23505.
export async function updateUser(input: UpdateUserInput): Promise<void> {
  await pool.query(
    `UPDATE users
        SET name = $2, phone = $3, email = $4, role = $5, permissions = $6, supervisor_id = $7
      WHERE id = $1`,
    [input.id, input.name, input.phone, input.email, input.role, input.permissions, input.supervisor_id],
  );
}

// A candidate supervisor's eligibility, read from DB state (never trust the
// client). Used by the actions to enforce that an assigned supervisor exists, is
// active, and holds a supervisory role. Null if the id doesn't exist.
export async function getSupervisorCandidate(
  id: string,
): Promise<{ role: Role; active: boolean } | null> {
  const { rows } = await pool.query<{ role: Role; active: boolean }>(
    `SELECT role, active FROM users WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function setUserPassword(
  id: string,
  password_hash: string,
): Promise<void> {
  await pool.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [
    id,
    password_hash,
  ]);
}

// Active staff who HOLD a given permission - admin implicitly holds every
// permission (mirrors hasPermission in lib/permissions.ts), a non-admin only
// if it's in their granted permissions array. For pickers that should only
// ever offer names of people actually authorized for something (e.g. "who
// can create a procedure bill"), not every staff member.
export async function listUsersWithPermission(
  permission: PermissionKey,
  locationId: string,
): Promise<{ id: string; name: string }[]> {
  const { rows } = await pool.query<{ id: string; name: string }>(
    `SELECT id, name
       FROM users
      WHERE active
        AND (role = 'admin' OR $1 = ANY(permissions))
        AND location_id = $2
      ORDER BY name`,
    [permission, locationId],
  );
  return rows;
}

// Active staff in a given set of roles, for pickers that should only ever offer
// people who can actually do something scoped by role (e.g. "who can create a
// procedure bill" - the counter roles). Admin is included only if it's in the set.
export async function listUsersByRole(
  roles: readonly Role[],
  locationId: string,
): Promise<{ id: string; name: string }[]> {
  const { rows } = await pool.query<{ id: string; name: string }>(
    `SELECT id, name
       FROM users
      WHERE active
        AND role = ANY($1)
        AND location_id = $2
      ORDER BY name`,
    [roles as readonly string[], locationId],
  );
  return rows;
}

// Active supervisors/admins AT ONE LOCATION who hold a discount-approval PIN, with
// their pin_hash. A discount PIN is verified by trying each hash (scrypt is salted
// per-row, so it can't be looked up directly) - the matching row is the approver.
// SECURITY: the hash never leaves the server; callers use it only with verifyPassword.
// The location filter is part of the authorization, not a display concern: approving a
// discount is a decision about THIS branch's money, so only this branch's supervisors
// are candidates (§8). Unscoped, one branch's PIN silently worked at another's counter.
export async function listDiscountApprovers(
  locationId: string,
): Promise<{ id: string; name: string; pin_hash: string }[]> {
  const { rows } = await pool.query<{ id: string; name: string; pin_hash: string }>(
    `SELECT id, name, pin_hash
       FROM users
      WHERE active
        AND pin_hash IS NOT NULL
        AND role IN ('supervisor', 'admin')
        AND location_id = $1`,
    [locationId],
  );
  return rows;
}

// null clears the PIN (pin_hash = NULL).
export async function setUserPin(
  id: string,
  pin_hash: string | null,
): Promise<void> {
  await pool.query(`UPDATE users SET pin_hash = $2 WHERE id = $1`, [id, pin_hash]);
}

export async function setUserActive(id: string, active: boolean): Promise<void> {
  await pool.query(`UPDATE users SET active = $2 WHERE id = $1`, [id, active]);
}

// The creating admin's location becomes the new user's (plan D-B). Returns null
// if the admin row somehow vanished (treated as a hard error by the caller).
export async function getUserLocationId(
  adminId: string,
): Promise<string | null> {
  const { rows } = await pool.query<{ location_id: string }>(
    `SELECT location_id FROM users WHERE id = $1`,
    [adminId],
  );
  return rows[0]?.location_id ?? null;
}

// For the lock-out / self guards - always read from DB state, never trust the
// client (plan D-C, §10).
export async function getUserRoleActive(
  id: string,
): Promise<{ role: Role; active: boolean } | null> {
  const { rows } = await pool.query<{ role: Role; active: boolean }>(
    `SELECT role, active FROM users WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

// Authorization snapshot for requirePermission (plan B-2): the session carries
// only `role`, so a permission check must read the CURRENT role/active/permissions
// from the DB - a grant change then takes effect immediately, not after re-login.
// Memoized per request (React cache) so several checks in one render share one
// query. Null if the user row is gone. SECURITY: no hashes selected out.
export const getUserAuthz = cache(
  async (
    id: string,
  ): Promise<{ role: Role; active: boolean; permissions: string[] } | null> => {
    const { rows } = await pool.query<{
      role: Role;
      active: boolean;
      permissions: string[];
    }>(`SELECT role, active, permissions FROM users WHERE id = $1`, [id]);
    return rows[0] ?? null;
  },
);

export async function activeAdminCount(): Promise<number> {
  const { rows } = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM users WHERE role = 'admin' AND active`,
  );
  return rows[0].count;
}

// Aggregate counts for the admin dashboard tiles - one query, computed in the DB.
// FILTER keeps it a single pass over the (tiny) users table.
export interface UserStats {
  total: number;
  active: number;
  supervisors: number;
  archived: number;
}

// Just the display name, for the top bar + dashboard greeting. Memoized per
// request (React cache) so the layout and the page share one query. Null if gone.
export const getUserName = cache(async (id: string): Promise<string | null> => {
  const { rows } = await pool.query<{ name: string }>(
    `SELECT name FROM users WHERE id = $1`,
    [id],
  );
  return rows[0]?.name ?? null;
});

// Name + contact for the top-bar account popover. Same shape/pattern as
// getUserName (one query, memoized per request via React cache), just the extra
// contact columns the popover shows. No hashes selected out (§10). Null if gone.
export interface UserProfile {
  name: string;
  phone: string;
  email: string | null;
  supervisor_name: string | null; // who this user reports to; null when unassigned
}

export const getUserProfile = cache(
  async (id: string): Promise<UserProfile | null> => {
    const { rows } = await pool.query<UserProfile>(
      `SELECT u.name, u.phone, u.email, sup.name AS supervisor_name
         FROM users u
         LEFT JOIN users sup ON sup.id = u.supervisor_id
        WHERE u.id = $1`,
      [id],
    );
    return rows[0] ?? null;
  },
);

// Staff counts for ONE location - never the whole company. Scoping these is the
// `location_id`-from-day-one rule (§4): with one branch it reads the same either way,
// but on the day a second branch exists an unscoped count silently reports another
// branch's staff to this admin, and by then nobody remembers to look here.
export async function getUserStats(locationId: string): Promise<UserStats> {
  const { rows } = await pool.query<UserStats>(
    `SELECT count(*)::int                                    AS total,
            count(*) FILTER (WHERE active)::int              AS active,
            count(*) FILTER (WHERE role = 'supervisor')::int AS supervisors,
            count(*) FILTER (WHERE NOT active)::int          AS archived
       FROM users
      WHERE location_id = $1`,
    [locationId],
  );
  return rows[0];
}

// Recent audit_log entries for the app-wide activity feed. The driving table is
// audit_log: ORDER BY at DESC LIMIT n uses audit_log_at_idx, so only the handful
// of rows shown are ever name-resolved. The target is resolved from the table
// named by `entity` using its type-agnostic target_id (migration 0003).
//
// Two things matter in the joins:
//   1. GUARD by a.entity - doctor and patient ids are both bigints from
//      independent sequences, so doctor #5 and patient #5 both exist. Without the
//      guard a patient event would resolve to the same-id doctor's name.
//   2. Keep each PK column BARE and cast target_id to the column's type instead
//      (`= a.target_id::bigint`, not `id::text = a.target_id`). Casting the
//      indexed column would defeat the primary-key index and force a full scan of
//      the dimension table; comparing against the bare id lets Postgres index-seek
//      the ~30 target rows. The CASE makes the cast entity-safe - a bigint
//      target_id is never handed to ::uuid (and vice-versa); non-matching entities
//      yield NULL, which simply doesn't match.
// Read-only; the UI turns action → text/tone via lib/admin/activity.
export interface ActivityRow {
  id: string;
  action: string;
  at: Date;
  actor_name: string | null;
  target_name: string | null;
  details: Record<string, unknown> | null;
}

// Scoped to ONE location (§4), tolerant of the rare pre-location audit row - the same
// `location_id = $2 OR location_id IS NULL` shape the report's getActivityCounts uses,
// so an old row is still visible to somebody rather than lost. Without the filter this
// feed showed every branch's activity to every admin.
export async function listRecentActivity(
  locationId: string,
  limit = 6,
): Promise<ActivityRow[]> {
  const { rows } = await pool.query<ActivityRow>(
    `SELECT a.id::text                        AS id,
            a.action,
            a.at,
            a.details,
            actor.name                        AS actor_name,
            COALESCE(tu.name, td.name, tp.name, ts.name) AS target_name
       FROM audit_log a
       LEFT JOIN users    actor ON actor.id = a.user_id
       LEFT JOIN users    tu ON tu.id = (CASE WHEN a.entity = 'user'    THEN a.target_id END)::uuid
       LEFT JOIN doctors  td ON td.id = (CASE WHEN a.entity = 'doctor'  THEN a.target_id END)::bigint
       LEFT JOIN patients tp ON tp.id = (CASE WHEN a.entity = 'patient' THEN a.target_id END)::bigint
       LEFT JOIN services ts ON ts.id = (CASE WHEN a.entity = 'service' THEN a.target_id END)::bigint
      WHERE a.location_id = $2 OR a.location_id IS NULL
      ORDER BY a.at DESC
      LIMIT $1`,
    [limit, locationId],
  );
  return rows;
}
