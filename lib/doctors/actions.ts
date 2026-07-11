"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/dal";
import { logActivity } from "@/lib/audit";
import { rupeesToPaise } from "@/lib/money";
import { zodFieldErrors } from "@/lib/forms/action-result";
import type { ActionResult } from "@/lib/forms/action-result";
import { getUserLocationId } from "@/lib/users/repository";
import {
  newDoctorSchema,
  updateDoctorSchema,
  setDoctorActiveSchema,
} from "./schema";
import { createDoctor, updateDoctor, setDoctorActive } from "./repository";

// Server Actions for the doctors master list (plan §5). Each mirrors the user
// actions: it takes a TYPED values object (RHF handleSubmit → action, not
// FormData), re-validates with the same zod schema the client uses (never trust
// the client - §9), converts the fee to integer paise, performs the mutation,
// audits it, and revalidates the page.
//
// requireAdmin() runs inside EVERY action - hiding UI is not security (§9). The
// (dashboard) layout already gates the page, but the action is a public endpoint
// on its own, so it re-checks. Doctors have no unique constraints (two may share
// a name) → no 23505 handling; and they aren't logins → no lock-out guards.

const PANEL_PATH = "/admin/doctors";

export async function createDoctorAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const s = await requireAdmin();

  const parsed = newDoctorSchema.safeParse(input);
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

  const { id } = await createDoctor({
    name: v.name,
    department: v.department || null,
    fee_paise: rupeesToPaise(v.fee),
    revisit_validity_days: v.revisitValidityDays,
    location_id: locationId,
  });

  await logActivity({
    actorId: s.sub,
    action: "doctor.create",
    entity: "doctor",
    targetId: id,
    locationId,
  });
  revalidatePath(PANEL_PATH);
  return { ok: true, data: { id } };
}

export async function updateDoctorAction(input: unknown): Promise<ActionResult> {
  const s = await requireAdmin();

  const parsed = updateDoctorSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: zodFieldErrors(parsed.error) };
  }
  const v = parsed.data;

  await updateDoctor({
    id: v.id,
    name: v.name,
    department: v.department || null,
    fee_paise: rupeesToPaise(v.fee),
    revisit_validity_days: v.revisitValidityDays,
  });

  await logActivity({
    actorId: s.sub,
    action: "doctor.update",
    entity: "doctor",
    targetId: v.id,
    locationId: await getUserLocationId(s.sub),
  });
  revalidatePath(PANEL_PATH);
  return { ok: true };
}

export async function setDoctorActiveAction(
  input: unknown,
): Promise<ActionResult> {
  const s = await requireAdmin();

  const parsed = setDoctorActiveSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: zodFieldErrors(parsed.error) };
  }
  const v = parsed.data;

  await setDoctorActive(v.id, v.active);
  await logActivity({
    actorId: s.sub,
    action: v.active ? "doctor.activate" : "doctor.deactivate",
    entity: "doctor",
    targetId: v.id,
    locationId: await getUserLocationId(s.sub),
  });
  revalidatePath(PANEL_PATH);
  return { ok: true };
}
