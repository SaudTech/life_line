"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/dal";
import { logActivity } from "@/lib/audit";
import { rupeesToPaise } from "@/lib/money";
import { zodFieldErrors } from "@/lib/forms/action-result";
import type { ActionResult } from "@/lib/forms/action-result";
import { getUserLocationId } from "@/lib/users/repository";
import {
  newServiceSchema,
  updateServiceSchema,
  setServiceActiveSchema,
  setServiceTrashedSchema,
} from "./schema";
import {
  createService,
  updateService,
  setServiceActive,
  setServiceTrashed,
} from "./repository";

// Server Actions for the services master list (plan §1A). Each mirrors the doctor
// actions: it takes a TYPED values object (RHF handleSubmit → action, not
// FormData), re-validates with the same zod schema the client uses (never trust
// the client - §8), converts the price to integer paise, performs the mutation,
// audits it, and revalidates the page.
//
// requireAdmin() runs inside EVERY action - hiding UI is not security (§8). The
// (dashboard) layout already gates the page, but the action is a public endpoint
// on its own, so it re-checks. Services have no unique constraint (two may share
// a name) → no 23505 handling; and they aren't logins → no lock-out guards.

const PANEL_PATH = "/admin/services";

export async function createServiceAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const s = await requireAdmin();

  const parsed = newServiceSchema.safeParse(input);
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

  const { id } = await createService({
    name: v.name,
    price_paise: rupeesToPaise(v.price),
    location_id: locationId,
  });

  await logActivity({
    actorId: s.sub,
    action: "service.create",
    entity: "service",
    targetId: id,
    locationId,
  });
  revalidatePath(PANEL_PATH);
  return { ok: true, data: { id } };
}

export async function updateServiceAction(
  input: unknown,
): Promise<ActionResult> {
  const s = await requireAdmin();

  const parsed = updateServiceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: zodFieldErrors(parsed.error) };
  }
  const v = parsed.data;

  await updateService({
    id: v.id,
    name: v.name,
    price_paise: rupeesToPaise(v.price),
  });

  await logActivity({
    actorId: s.sub,
    action: "service.update",
    entity: "service",
    targetId: v.id,
    locationId: await getUserLocationId(s.sub),
  });
  revalidatePath(PANEL_PATH);
  return { ok: true };
}

export async function setServiceActiveAction(
  input: unknown,
): Promise<ActionResult> {
  const s = await requireAdmin();

  const parsed = setServiceActiveSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: zodFieldErrors(parsed.error) };
  }
  const v = parsed.data;

  await setServiceActive(v.id, v.active);
  await logActivity({
    actorId: s.sub,
    action: v.active ? "service.activate" : "service.deactivate",
    entity: "service",
    targetId: v.id,
    locationId: await getUserLocationId(s.sub),
  });
  revalidatePath(PANEL_PATH);
  return { ok: true };
}

export async function setServiceTrashedAction(
  input: unknown,
): Promise<ActionResult> {
  const s = await requireAdmin();

  const parsed = setServiceTrashedSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: zodFieldErrors(parsed.error) };
  }
  const v = parsed.data;

  await setServiceTrashed(v.id, v.trashed);
  await logActivity({
    actorId: s.sub,
    action: v.trashed ? "service.trash" : "service.restore",
    entity: "service",
    targetId: v.id,
    locationId: await getUserLocationId(s.sub),
  });
  revalidatePath(PANEL_PATH);
  return { ok: true };
}
