"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/dal";
import { logActivity } from "@/lib/audit";
import { rupeesToPaise } from "@/lib/money";
import { zodFieldErrors } from "@/lib/forms/action-result";
import type { ActionResult } from "@/lib/forms/action-result";
import { getUserLocationId } from "@/lib/users/repository";
import { listDepartments } from "@/lib/departments/repository";
import { getTemplateById } from "@/lib/printing/repository";
import {
  newDoctorSchema,
  updateDoctorSchema,
  setDoctorActiveSchema,
} from "./schema";
import { createDoctor, updateDoctor, setDoctorActive } from "./repository";

// Department is free TEXT on the doctors row (no FK - migration 0016/0020), so
// the client Combobox choosing one by name isn't itself proof it's real: check
// it against the location's department list here, authoritatively (never trust
// the client).
async function isKnownDepartment(name: string, locationId: string): Promise<boolean> {
  const departments = await listDepartments(locationId);
  return departments.some((d) => d.name === name);
}

// The form sends "" for "use the default consultation design" and an id for a
// custom one (migration 0024). An id is only accepted if it is a real
// CONSULTATION design at THIS location - the FK alone can't check either, and a
// mis-pointed row would otherwise sit in the table until the print route
// silently fell back. Returns the value to store, or an error for the field.
async function resolveConsultationTemplate(
  raw: string,
  locationId: string,
): Promise<{ value: string | null } | { error: string }> {
  if (!raw) return { value: null }; // default design - the common case
  const tpl = await getTemplateById(raw, locationId);
  if (!tpl) return { error: "That design no longer exists. Pick another." };
  if (tpl.bill_type !== "consultation") {
    return { error: "Pick a consultation design." };
  }
  return { value: raw };
}

// Split the form's single percent-OR-flat share field into the two DB columns
// (migration 0021) - only the one matching `doctorShareType` is populated, same
// pattern as resolveDiscountPaise (lib/billing/discount.ts).
function resolveDoctorShare(v: {
  doctorShareType: "percentage" | "flat";
  doctorShareValue: string;
}): { share_type: string; share_percentage: number; share_flat_paise: number | null } {
  if (v.doctorShareType === "percentage") {
    return { share_type: "percentage", share_percentage: Number(v.doctorShareValue), share_flat_paise: null };
  }
  return { share_type: "flat", share_percentage: 0, share_flat_paise: rupeesToPaise(v.doctorShareValue) };
}

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

  if (!(await isKnownDepartment(v.department, locationId))) {
    return { ok: false, fieldErrors: { department: "Select a department from the list." } };
  }

  const template = await resolveConsultationTemplate(v.consultationTemplateId, locationId);
  if ("error" in template) {
    return { ok: false, fieldErrors: { consultationTemplateId: template.error } };
  }

  const { id } = await createDoctor({
    name: v.name,
    department: v.department,
    phone: v.phone,
    status: v.status,
    fee_paise: rupeesToPaise(v.fee),
    revisit_validity_days: v.revisitValidityDays,
    ...resolveDoctorShare(v),
    consultation_template_id: template.value,
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

  const locationId = await getUserLocationId(s.sub);
  if (!locationId) {
    return {
      ok: false,
      formError: "Could not resolve your location. Please sign in again.",
    };
  }

  if (!(await isKnownDepartment(v.department, locationId))) {
    return { ok: false, fieldErrors: { department: "Select a department from the list." } };
  }

  const template = await resolveConsultationTemplate(v.consultationTemplateId, locationId);
  if ("error" in template) {
    return { ok: false, fieldErrors: { consultationTemplateId: template.error } };
  }

  await updateDoctor({
    id: v.id,
    name: v.name,
    department: v.department,
    phone: v.phone,
    status: v.status,
    fee_paise: rupeesToPaise(v.fee),
    revisit_validity_days: v.revisitValidityDays,
    ...resolveDoctorShare(v),
    consultation_template_id: template.value,
  });

  await logActivity({
    actorId: s.sub,
    action: "doctor.update",
    entity: "doctor",
    targetId: v.id,
    locationId,
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
