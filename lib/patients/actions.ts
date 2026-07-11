"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/dal";
import { logActivity } from "@/lib/audit";
import { zodFieldErrors } from "@/lib/forms/action-result";
import type { ActionResult } from "@/lib/forms/action-result";
import { getUserLocationId } from "@/lib/users/repository";
import { newPatientSchema, updatePatientSchema } from "./schema";
import {
  createPatient,
  updatePatient,
  searchPatients,
  type PatientRow,
} from "./repository";

// Server Actions for the patients master list (plan §5). Each mirrors the doctor
// actions: it takes a TYPED values object (RHF handleSubmit → action, not
// FormData), re-validates with the same zod schema the client uses (never trust
// the client - §9), performs the mutation, audits it, and revalidates the page.
//
// requireAdmin() runs inside EVERY action - hiding UI is not security (§9). The
// (dashboard) layout gates the page, but the action is a public endpoint on its
// own, so it re-checks.
//
// No 23505 handling: patient_code is the only unique column and the DB mints it
// (we never set it); phone is deliberately NON-unique (duplicates are correct).

const PANEL_PATH = "/patients";

// age arrives as number | "" | undefined from the schema union - normalise the
// empty/absent cases to a real NULL for the column.
function normalizeAge(age: number | "" | undefined): number | null {
  return typeof age === "number" ? age : null;
}

export async function createPatientAction(
  input: unknown,
): Promise<ActionResult<{ id: string; patient_code: string }>> {
  const s = await requireAdmin();

  const parsed = newPatientSchema.safeParse(input);
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

  const { id, patient_code } = await createPatient({
    name: v.name,
    phone: v.phone, // required in the form, always present
    age: normalizeAge(v.age),
    area: v.area || null,
    gender: v.gender || null,
    location_id: locationId,
  });

  await logActivity({
    actorId: s.sub,
    action: "patient.create",
    entity: "patient",
    targetId: id,
    locationId,
    details: { patient_code },
  });
  revalidatePath(PANEL_PATH);
  return { ok: true, data: { id, patient_code } };
}

export async function updatePatientAction(input: unknown): Promise<ActionResult> {
  const s = await requireAdmin();

  const parsed = updatePatientSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: zodFieldErrors(parsed.error) };
  }
  const v = parsed.data;

  await updatePatient({
    id: v.id,
    name: v.name,
    phone: v.phone,
    age: normalizeAge(v.age),
    area: v.area || null,
    gender: v.gender || null,
  });

  await logActivity({
    actorId: s.sub,
    action: "patient.update",
    entity: "patient",
    targetId: v.id,
    locationId: await getUserLocationId(s.sub),
  });
  revalidatePath(PANEL_PATH);
  return { ok: true };
}

// Read-only search for the management screen (plan §5). The table grows large, so
// the screen is search-driven - this action backs the search box. Admin-only like
// the mutations; no revalidation (it reads nothing it writes).
export async function searchPatientsAction(
  q: string,
): Promise<ActionResult<PatientRow[]>> {
  await requireAdmin();
  const rows = await searchPatients(typeof q === "string" ? q : "");
  return { ok: true, data: rows };
}
