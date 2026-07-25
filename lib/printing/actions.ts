"use server";

import { revalidatePath } from "next/cache";
import { checkTemplate, type Template } from "@pdfme/common";
import { requireAdmin, requireSession } from "@/lib/auth/dal";
import { logActivity } from "@/lib/audit";
import { zodFieldErrors } from "@/lib/forms/action-result";
import type { ActionResult } from "@/lib/forms/action-result";
import { getUserLocationId } from "@/lib/users/repository";
import { fieldKeysForType, type BillType } from "./fields";
import { getDefaultTemplate } from "./defaults";
import {
  getActiveTemplate,
  resetToDefault,
  listTemplates,
  getTemplateById,
  createTemplate,
  updateTemplate,
  activateTemplate,
  duplicateTemplate,
  deleteTemplate,
  type BillTemplateRow,
  type TemplateSummary,
} from "./repository";
import {
  getTemplateSchema,
  createTemplateSchema,
  updateTemplateSchema,
  renameTemplateSchema,
  templateIdOnlySchema,
  logReceiptPrintedSchema,
} from "./schema";

const TYPE_LABELS: Record<BillType, string> = {
  consultation: "Consultation",
  procedure: "Procedure",
  ip: "IP",
  advance: "Advance",
  end_day: "End-of-day report",
};

// Server Actions for the admin receipt/report builder (plan §5). admin-only -
// the (dashboard)/admin layout already gates the route, but every action
// re-checks (hiding UI is not security, §8). Every save is re-validated:
// structurally by pdfme's own checkTemplate, and semantically by cross-checking
// every field the template references against the field catalog for that bill
// type (lib/printing/fields.ts) - the one source of truth for what's bindable.

const PANEL_PATH = "/admin/receipts";

export async function getActiveTemplateAction(
  input: unknown,
): Promise<ActionResult<BillTemplateRow>> {
  const s = await requireAdmin();
  const parsed = getTemplateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: zodFieldErrors(parsed.error) };
  }
  const locationId = await getUserLocationId(s.sub);
  if (!locationId) {
    return { ok: false, formError: "Could not resolve your location. Please sign in again." };
  }
  const template = await getActiveTemplate(parsed.data.type, locationId);
  return { ok: true, data: template };
}

// Reused by create AND update so no design - however it's saved - can be
// structurally invalid or bind a field foreign to its bill type (plan §3).
// Returns an error string, or null when the layout is valid for `type`.
//   - Structural validity: pdfme's own checkTemplate.
//   - Semantic validity: every DATA field the template references must be a
//     catalog key for this type. Exempt from the catalog check:
//       * image/shape fields (static art: a logo, dividers, boxes).
//       * readOnly text/multiVariableText - static labels that render their own
//         `content` at generate time (pdfme: readOnly ⇒ render content, not the
//         input value), so they bind to no data and need no catalog key. This is
//         what lets an admin add free-form static text (a title, an "Authorised
//         Signatory" line) in the builder without it being rejected.
function validateTemplateForType(type: BillType, schemaJson: unknown): string | null {
  try {
    checkTemplate(schemaJson);
  } catch {
    return "That layout isn't a valid template.";
  }
  const knownKeys = new Set(fieldKeysForType(type));
  const schemas =
    (schemaJson as { schemas?: { name: string; type: string; readOnly?: boolean }[][] }).schemas ??
    [];
  const unknownKeys = schemas
    .flat()
    .filter(
      (f) =>
        !f.readOnly &&
        (f.type === "text" || f.type === "multiVariableText" || f.type === "table"),
    )
    .map((f) => f.name)
    .filter((k) => !knownKeys.has(k));
  if (unknownKeys.length > 0) {
    return `This layout uses field(s) that don't belong to a ${type} receipt: ${unknownKeys.join(", ")}`;
  }
  return null;
}

// Resolve the caller's location once, the same way every action does. Returns
// the id, or an ActionResult error to return straight back.
async function resolveLocation(
  sub: string,
): Promise<{ locationId: string } | { error: ActionResult<never> }> {
  const locationId = await getUserLocationId(sub);
  if (!locationId) {
    return {
      error: { ok: false, formError: "Could not resolve your location. Please sign in again." },
    };
  }
  return { locationId };
}

export async function listTemplatesAction(): Promise<ActionResult<TemplateSummary[]>> {
  const s = await requireAdmin();
  const loc = await resolveLocation(s.sub);
  if ("error" in loc) return loc.error;
  return { ok: true, data: await listTemplates(loc.locationId) };
}

export async function getTemplateAction(
  input: unknown,
): Promise<ActionResult<BillTemplateRow>> {
  const s = await requireAdmin();
  const parsed = templateIdOnlySchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: zodFieldErrors(parsed.error) };
  const loc = await resolveLocation(s.sub);
  if ("error" in loc) return loc.error;
  const row = await getTemplateById(parsed.data.id, loc.locationId);
  if (!row) return { ok: false, formError: "That design no longer exists." };
  return { ok: true, data: row };
}

// Create a design. With only `type` (the "New design" click) the server seeds
// the checked-in default and a starter name; with a layout/name it validates and
// stores them. The first design of a type becomes active (repository guard).
export async function createTemplateAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const s = await requireAdmin();
  const parsed = createTemplateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: zodFieldErrors(parsed.error) };
  const v = parsed.data;

  const schemaJson = (v.schemaJson as unknown as Template) ?? getDefaultTemplate(v.type);
  if (v.schemaJson) {
    const err = validateTemplateForType(v.type, v.schemaJson);
    if (err) return { ok: false, formError: err };
  }

  const loc = await resolveLocation(s.sub);
  if ("error" in loc) return loc.error;

  const name = v.name ?? `${TYPE_LABELS[v.type]} design`;
  const { id } = await createTemplate({
    type: v.type,
    locationId: loc.locationId,
    name,
    schemaJson,
    updatedBy: s.sub,
  });

  await logActivity({
    actorId: s.sub,
    action: "receipt.template_created",
    entity: "bill_template",
    targetId: id,
    locationId: loc.locationId,
    details: { bill_type: v.type, name },
  });
  revalidatePath(PANEL_PATH);
  return { ok: true, data: { id } };
}

// The editor's "Save" - update this design in place. The bill type comes from
// the existing row (a design's type is fixed), and the layout is validated
// against it before writing.
export async function updateTemplateAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const s = await requireAdmin();
  const parsed = updateTemplateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: zodFieldErrors(parsed.error) };
  const v = parsed.data;

  const loc = await resolveLocation(s.sub);
  if ("error" in loc) return loc.error;

  const existing = await getTemplateById(v.id, loc.locationId);
  if (!existing) return { ok: false, formError: "That design no longer exists." };

  const err = validateTemplateForType(existing.bill_type, v.schemaJson);
  if (err) return { ok: false, formError: err };

  const updated = await updateTemplate({
    id: v.id,
    locationId: loc.locationId,
    name: v.name,
    schemaJson: v.schemaJson as unknown as Template,
    updatedBy: s.sub,
  });
  if (!updated) return { ok: false, formError: "Could not save this design." };

  await logActivity({
    actorId: s.sub,
    action: "receipt.template_saved",
    entity: "bill_template",
    targetId: v.id,
    locationId: loc.locationId,
    details: { bill_type: existing.bill_type, name: v.name },
  });
  revalidatePath(PANEL_PATH);
  return { ok: true, data: { id: v.id } };
}

export async function renameTemplateAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const s = await requireAdmin();
  const parsed = renameTemplateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: zodFieldErrors(parsed.error) };
  const v = parsed.data;

  const loc = await resolveLocation(s.sub);
  if ("error" in loc) return loc.error;

  const existing = await getTemplateById(v.id, loc.locationId);
  if (!existing) return { ok: false, formError: "That design no longer exists." };

  const updated = await updateTemplate({
    id: v.id,
    locationId: loc.locationId,
    name: v.name,
    updatedBy: s.sub,
  });
  if (!updated) return { ok: false, formError: "Could not rename this design." };

  await logActivity({
    actorId: s.sub,
    action: "receipt.template_saved",
    entity: "bill_template",
    targetId: v.id,
    locationId: loc.locationId,
    details: { bill_type: existing.bill_type, name: v.name },
  });
  revalidatePath(PANEL_PATH);
  return { ok: true, data: { id: v.id } };
}

// Make a design the active (printed) one for its type - atomic in the repository
// (never zero or two active).
export async function activateTemplateAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const s = await requireAdmin();
  const parsed = templateIdOnlySchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: zodFieldErrors(parsed.error) };

  const loc = await resolveLocation(s.sub);
  if ("error" in loc) return loc.error;

  const existing = await getTemplateById(parsed.data.id, loc.locationId);
  if (!existing) return { ok: false, formError: "That design no longer exists." };

  const ok = await activateTemplate(parsed.data.id, loc.locationId, s.sub);
  if (!ok) return { ok: false, formError: "Could not set this design active." };

  await logActivity({
    actorId: s.sub,
    action: "receipt.template_activated",
    entity: "bill_template",
    targetId: parsed.data.id,
    locationId: loc.locationId,
    details: { bill_type: existing.bill_type, name: existing.name },
  });
  revalidatePath(PANEL_PATH);
  return { ok: true, data: { id: parsed.data.id } };
}

export async function duplicateTemplateAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const s = await requireAdmin();
  const parsed = templateIdOnlySchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: zodFieldErrors(parsed.error) };

  const loc = await resolveLocation(s.sub);
  if ("error" in loc) return loc.error;

  const source = await getTemplateById(parsed.data.id, loc.locationId);
  if (!source) return { ok: false, formError: "That design no longer exists." };

  const created = await duplicateTemplate(parsed.data.id, loc.locationId, s.sub);
  if (!created) return { ok: false, formError: "Could not duplicate this design." };

  await logActivity({
    actorId: s.sub,
    action: "receipt.template_duplicated",
    entity: "bill_template",
    targetId: created.id,
    locationId: loc.locationId,
    details: { bill_type: source.bill_type, name: `${source.name} (copy)` },
  });
  revalidatePath(PANEL_PATH);
  return { ok: true, data: { id: created.id } };
}

// Delete a design - guarded in the repository (never the active one, never the
// last of a type); the guard's reason is surfaced to the admin verbatim. Doctors
// assigned to it (migration 0024) are cleared in the same transaction and
// returned, so the UI can confirm exactly who fell back to the active design.
export async function deleteTemplateAction(
  input: unknown,
): Promise<ActionResult<{ unassigned: string[] }>> {
  const s = await requireAdmin();
  const parsed = templateIdOnlySchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: zodFieldErrors(parsed.error) };

  const loc = await resolveLocation(s.sub);
  if ("error" in loc) return loc.error;

  const existing = await getTemplateById(parsed.data.id, loc.locationId);
  if (!existing) return { ok: false, formError: "That design no longer exists." };

  const result = await deleteTemplate(parsed.data.id, loc.locationId);
  if (!result.ok) return { ok: false, formError: result.reason };

  await logActivity({
    actorId: s.sub,
    action: "receipt.template_deleted",
    entity: "bill_template",
    targetId: parsed.data.id,
    locationId: loc.locationId,
    details: {
      bill_type: existing.bill_type,
      name: existing.name,
      // Doctors who were printing on this design and are now back on the
      // location's active one (migration 0024) - recorded by name so the change
      // is traceable later, never silent.
      unassigned_doctors: result.unassigned,
    },
  });
  revalidatePath(PANEL_PATH);
  revalidatePath("/admin/doctors");
  return { ok: true, data: { unassigned: result.unassigned } };
}

export async function resetTemplateAction(
  input: unknown,
): Promise<ActionResult<BillTemplateRow>> {
  const s = await requireAdmin();
  const parsed = getTemplateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: zodFieldErrors(parsed.error) };
  }
  const locationId = await getUserLocationId(s.sub);
  if (!locationId) {
    return { ok: false, formError: "Could not resolve your location. Please sign in again." };
  }

  const { id } = await resetToDefault(parsed.data.type, locationId, s.sub);
  await logActivity({
    actorId: s.sub,
    action: "receipt.template_reset",
    entity: "bill_template",
    targetId: id,
    locationId,
    details: { bill_type: parsed.data.type },
  });
  revalidatePath(PANEL_PATH);
  const template = await getActiveTemplate(parsed.data.type, locationId);
  return { ok: true, data: template };
}

// Any signed-in staff member may print (not admin-only, unlike the builder
// actions above) - printing is a counter action, not a design one. Best-effort:
// a logging failure must never surface to the counter or block the print that
// already happened (print plan §4).
export async function logReceiptPrintedAction(input: unknown): Promise<ActionResult> {
  const s = await requireSession();
  const parsed = logReceiptPrintedSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: zodFieldErrors(parsed.error) };
  }
  const v = parsed.data;
  await logActivity({
    actorId: s.sub,
    action: "receipt.printed",
    entity: "bill",
    targetId: v.billId,
    locationId: await getUserLocationId(s.sub),
    details: { bill_number: v.billNumber, copy: v.copy },
  });
  return { ok: true };
}
