// The canonical permission registry - the single source of truth for every
// grantable capability in the app (plan 1B). PURE and client-safe: no DB, no
// React, no server-only imports, so the client user form (checkbox list), the
// server actions (authoritative validation), requirePermission, and the tests all
// share ONE definition of what a permission means (DEVELOPMENT_RULES §2).
//
// Permissions are ADDITIVE to roles, not a replacement. A role sets the coarse
// access; a permission grants one specific extra capability to a chosen non-admin.
// `admin` implicitly holds every permission (see hasPermission).
//
// Naming convention: `domain.verb`, lower_snake. Adding a capability = add its key
// HERE (never an ad-hoc string at a call site). The typed PermissionKey union
// makes a mistyped key a COMPILE error, and PERMISSION_KEYS is what the server
// validates client input against - unknown keys are rejected (plan B-4).

export interface PermissionMeta {
  label: string;
  description: string;
}

// ONE registry of grantable capabilities. `admin` implicitly has all of these.
//
// INTENTIONALLY EMPTY today: the only former grant (the old service-line modify
// permission) was retired once procedure billing became a plain counter-ROLE
// capability (op_desk / op_ip_desk / admin), not a per-user grant. The registry
// shape is kept valid so a
// real grantable capability can be re-added here the day one exists (e.g. a genuine
// override: custom price, ad-hoc line, editing a finalized bill's lines).
export const PERMISSIONS = {
  // add grantable capabilities here as features need them
} as const satisfies Record<string, PermissionMeta>;

export type PermissionKey = keyof typeof PERMISSIONS;
export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[];

// The authority check. admin ⇒ everything; otherwise the key must be explicitly
// granted. Inactive users are handled by the caller (requirePermission) - this is
// the pure role/grant test only.
export function hasPermission(
  user: { role: string; permissions: readonly string[] },
  key: PermissionKey,
): boolean {
  return user.role === "admin" || user.permissions.includes(key);
}
