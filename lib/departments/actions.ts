"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/dal";
import { logActivity } from "@/lib/audit";
import { zodFieldErrors } from "@/lib/forms/action-result";
import type { ActionResult } from "@/lib/forms/action-result";
import { getUserLocationId } from "@/lib/users/repository";
import { newDepartmentSchema, deleteDepartmentSchema } from "./schema";
import { createDepartment, deleteDepartment } from "./repository";

// Server Actions for the departments master list (migration 0020). There is no
// standalone admin page for these - the only place a department is ever added
// or removed is inline, from the doctor form's department picker - so both
// actions revalidate the doctors page.
//
// requireAdmin() runs inside EVERY action - hiding UI is not security. Each
// re-validates with the same zod schema the client uses (never trust the
// client).

const PANEL_PATH = "/admin/doctors";

export async function createDepartmentAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const s = await requireAdmin();

  const parsed = newDepartmentSchema.safeParse(input);
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

  let id: string;
  try {
    ({ id } = await createDepartment({ name: v.name, location_id: locationId }));
  } catch (err) {
    if (typeof err === "object" && err !== null && "code" in err && err.code === "23505") {
      return { ok: false, fieldErrors: { name: "That department already exists." } };
    }
    throw err;
  }

  await logActivity({
    actorId: s.sub,
    action: "department.create",
    entity: "department",
    targetId: id,
    locationId,
  });
  revalidatePath(PANEL_PATH);
  return { ok: true, data: { id } };
}

export async function deleteDepartmentAction(input: unknown): Promise<ActionResult> {
  const s = await requireAdmin();

  const parsed = deleteDepartmentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: zodFieldErrors(parsed.error) };
  }
  const v = parsed.data;

  await deleteDepartment(v.id);
  await logActivity({
    actorId: s.sub,
    action: "department.delete",
    entity: "department",
    targetId: v.id,
    locationId: await getUserLocationId(s.sub),
  });
  revalidatePath(PANEL_PATH);
  return { ok: true };
}
