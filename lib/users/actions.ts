"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/dal";
import { hashPassword } from "@/lib/password";
import { logActivity } from "@/lib/audit";
import { zodFieldErrors } from "@/lib/forms/action-result";
import type { ActionResult } from "@/lib/forms/action-result";
import {
  newUserSchema,
  updateUserSchema,
  resetPasswordSchema,
  setPinSchema,
  setActiveSchema,
} from "./schema";
import {
  createUser,
  updateUser,
  setUserPassword,
  setUserPin,
  setUserActive,
  getUserLocationId,
  getUserRoleActive,
  getUserAuthz,
  getSupervisorCandidate,
  activeAdminCount,
} from "./repository";
import { PIN_ROLES } from "./schema";

// admin ⇒ every permission implicitly (plan B-3), so we never store redundant
// grants on an admin row - the effective grant set for an admin is always empty.
// Also de-duplicates so the stored array is clean.
function effectivePermissions(role: string, permissions: string[]): string[] {
  if (role === "admin") return [];
  return Array.from(new Set(permissions));
}

// Order-independent set comparison for detecting a permission change on update.
function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((x) => set.has(x));
}

// Validate an assigned supervisor against DB state (never the client): "" ⇒ no
// supervisor (null); otherwise the id must be an ACTIVE supervisor/admin and not
// the user themselves. Returns the normalised id (or null), or a field error to
// surface under the `supervisorId` control. `selfId` is null when creating.
async function resolveSupervisorId(
  supervisorId: string | undefined,
  selfId: string | null,
): Promise<{ ok: true; value: string | null } | { ok: false; message: string }> {
  const id = supervisorId?.trim();
  if (!id) return { ok: true, value: null };
  if (selfId && id === selfId) {
    return { ok: false, message: "A user can't be their own supervisor." };
  }
  const candidate = await getSupervisorCandidate(id);
  if (!candidate || !candidate.active || !PIN_ROLES.includes(candidate.role)) {
    return { ok: false, message: "Choose an active supervisor or admin." };
  }
  return { ok: true, value: id };
}

// Server Actions for staff-account management (plan §5). Each mirrors login's
// loginAction: it takes a TYPED values object (RHF handleSubmit → action, not
// FormData), re-validates with the same zod schema the client uses (never trust
// the client - §10), performs the mutation, audits it, and revalidates the page.
//
// requireAdmin() runs inside EVERY action: hiding UI is not security (§8). The
// (dashboard) layout already gates the page, but the action is a public endpoint
// on its own, so it re-checks.

const PANEL_PATH = "/admin/users";

// A user reachable by the client is a real UUID, but ids arrive as unknown input.

// Postgres unique-violation → per-field message (plan D-E). We map the two named
// constraints; anything else is re-thrown for the generic handler.
function uniqueViolationFields(err: unknown): Record<string, string> | null {
  if (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "23505"
  ) {
    const constraint = (err as { constraint?: string }).constraint;
    if (constraint === "users_phone_unique")
      return { phone: "That phone number is already in use." };
    if (constraint === "users_email_unique")
      return { email: "That email is already in use." };
    return { root: "That value is already in use." };
  }
  return null;
}

export async function createUserAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const s = await requireAdmin();

  const parsed = newUserSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: zodFieldErrors(parsed.error) };
  }
  const v = parsed.data;

  const locationId = await getUserLocationId(s.sub);
  if (!locationId) {
    return { ok: false, formError: "Could not resolve your location. Please sign in again." };
  }

  const supervisor = await resolveSupervisorId(v.supervisorId, null);
  if (!supervisor.ok) {
    return { ok: false, fieldErrors: { supervisorId: supervisor.message } };
  }

  const password_hash = await hashPassword(v.password);
  const pin_hash = v.pin ? await hashPassword(v.pin) : null;

  let id: string;
  try {
    ({ id } = await createUser({
      name: v.name,
      phone: v.phone,
      email: v.email || null,
      role: v.role,
      password_hash,
      pin_hash,
      permissions: effectivePermissions(v.role, v.permissions),
      supervisor_id: supervisor.value,
      location_id: locationId,
    }));
  } catch (err) {
    const fieldErrors = uniqueViolationFields(err);
    if (fieldErrors) return { ok: false, fieldErrors };
    throw err;
  }

  await logActivity({
    actorId: s.sub,
    action: "user.create",
    entity: "user",
    targetId: id,
    locationId,
    details: { role: v.role },
  });
  revalidatePath(PANEL_PATH);
  return { ok: true, data: { id } };
}

export async function updateUserAction(input: unknown): Promise<ActionResult> {
  const s = await requireAdmin();

  const parsed = updateUserSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: zodFieldErrors(parsed.error) };
  }
  const v = parsed.data;

  // Lock-out guard (plan D-C), computed from DB state. Demoting the last active
  // admin out of the admin role would leave zero active admins - refuse. Read the
  // full authz snapshot so we also have the CURRENT permissions to diff below.
  const current = await getUserAuthz(v.id);
  if (!current) {
    return { ok: false, formError: "That user no longer exists." };
  }
  if (
    current.role === "admin" &&
    current.active &&
    v.role !== "admin" &&
    (await activeAdminCount()) <= 1
  ) {
    return {
      ok: false,
      formError: "You can't remove the last active admin's admin role.",
    };
  }

  const supervisor = await resolveSupervisorId(v.supervisorId, v.id);
  if (!supervisor.ok) {
    return { ok: false, fieldErrors: { supervisorId: supervisor.message } };
  }

  const nextPermissions = effectivePermissions(v.role, v.permissions);
  const permissionsChanged = !sameSet(current.permissions, nextPermissions);

  try {
    await updateUser({
      id: v.id,
      name: v.name,
      phone: v.phone,
      email: v.email || null,
      role: v.role,
      permissions: nextPermissions,
      supervisor_id: supervisor.value,
    });
  } catch (err) {
    const fieldErrors = uniqueViolationFields(err);
    if (fieldErrors) return { ok: false, fieldErrors };
    throw err;
  }

  const locationId = await getUserLocationId(s.sub);
  await logActivity({
    actorId: s.sub,
    action: "user.update",
    entity: "user",
    targetId: v.id,
    locationId,
    details: { role: v.role },
  });
  // A separate, auditable tag when the grants themselves changed (plan 1B) - the
  // permissions list (not a secret) is recorded so the change is traceable.
  if (permissionsChanged) {
    await logActivity({
      actorId: s.sub,
      action: "user.permissions_change",
      entity: "user",
      targetId: v.id,
      locationId,
      details: { permissions: nextPermissions },
    });
  }
  revalidatePath(PANEL_PATH);
  return { ok: true };
}

export async function resetPasswordAction(input: unknown): Promise<ActionResult> {
  const s = await requireAdmin();

  const parsed = resetPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: zodFieldErrors(parsed.error) };
  }
  const v = parsed.data;

  await setUserPassword(v.id, await hashPassword(v.password));
  await logActivity({
    actorId: s.sub,
    action: "user.password_reset",
    entity: "user",
    targetId: v.id,
    locationId: await getUserLocationId(s.sub),
  });
  revalidatePath(PANEL_PATH);
  return { ok: true };
}

export async function setPinAction(input: unknown): Promise<ActionResult> {
  const s = await requireAdmin();

  const parsed = setPinSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: zodFieldErrors(parsed.error) };
  }
  const v = parsed.data;

  const locationId = await getUserLocationId(s.sub);
  if (v.pin === "") {
    await setUserPin(v.id, null);
    await logActivity({
      actorId: s.sub,
      action: "user.pin_clear",
      entity: "user",
      targetId: v.id,
      locationId,
    });
  } else {
    await setUserPin(v.id, await hashPassword(v.pin));
    await logActivity({
      actorId: s.sub,
      action: "user.pin_set",
      entity: "user",
      targetId: v.id,
      locationId,
    });
  }
  revalidatePath(PANEL_PATH);
  return { ok: true };
}

export async function setActiveAction(input: unknown): Promise<ActionResult> {
  const s = await requireAdmin();

  const parsed = setActiveSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: zodFieldErrors(parsed.error) };
  }
  const v = parsed.data;

  // Deactivation guards (plan D-C) - all derived from DB state, never the client.
  if (v.active === false) {
    if (v.id === s.sub) {
      return { ok: false, formError: "You can't deactivate your own account." };
    }
    const current = await getUserRoleActive(v.id);
    if (!current) {
      return { ok: false, formError: "That user no longer exists." };
    }
    if (current.role === "admin" && current.active && (await activeAdminCount()) <= 1) {
      return { ok: false, formError: "You can't deactivate the last active admin." };
    }
  }

  await setUserActive(v.id, v.active);
  await logActivity({
    actorId: s.sub,
    action: v.active ? "user.activate" : "user.deactivate",
    entity: "user",
    targetId: v.id,
    locationId: await getUserLocationId(s.sub),
  });
  revalidatePath(PANEL_PATH);
  return { ok: true };
}
