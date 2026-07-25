"use server";

import { requireAdmin, requireRole } from "@/lib/auth/dal";
import { logActivity } from "@/lib/audit";
import { zodFieldErrors } from "@/lib/forms/action-result";
import type { ActionResult } from "@/lib/forms/action-result";
import { getUserLocationId } from "@/lib/users/repository";
import { documentIdSchema, patientIdSchema, recordRefSchema } from "./schema";
import {
  getDocument,
  listPatientDocuments,
  listRecordDocuments,
  softDeleteDocument,
  type DocumentListRow,
} from "./repository";

// Server actions for patient documents. Listing a record's documents is open to
// EVERY staff role (any desk uploads and views scans - the client's requirement),
// gated on the server per dev-rules §8. The patient-wide view and delete are
// admin-only. Uploading goes through the multipart route
// (app/api/documents/upload) because files don't fit a server action; the
// authoritative checks live there.

const ALL_STAFF_ROLES = ["admin", "supervisor", "op_desk", "op_ip_desk"] as const;

// Documents attached to one consultation/admission - what the upload dialog
// shows when it opens.
export async function listRecordDocumentsAction(
  input: unknown,
): Promise<ActionResult<DocumentListRow[]>> {
  await requireRole(ALL_STAFF_ROLES);
  const parsed = recordRefSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: zodFieldErrors(parsed.error) };
  }
  const rows = await listRecordDocuments(parsed.data.recordType, parsed.data.recordId);
  return { ok: true, data: rows };
}

// Every document across a patient's records - the admin patient view.
export async function listPatientDocumentsAction(
  input: unknown,
): Promise<ActionResult<DocumentListRow[]>> {
  await requireAdmin();
  const parsed = patientIdSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: zodFieldErrors(parsed.error) };
  }
  const rows = await listPatientDocuments(parsed.data.patientId);
  return { ok: true, data: rows };
}

// Admin-only soft delete. Staff cannot delete once uploaded (the client's
// rule); the row is stamped, never removed, and the file stays on disk -
// audit-logged like every mutation.
export async function deleteDocumentAction(input: unknown): Promise<ActionResult> {
  const s = await requireAdmin();
  const parsed = documentIdSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: zodFieldErrors(parsed.error) };
  }
  const doc = await getDocument(parsed.data.documentId);
  if (!doc || doc.deleted_at) {
    return { ok: false, formError: "That document no longer exists." };
  }
  const deleted = await softDeleteDocument(doc.id, s.sub);
  if (!deleted) {
    return { ok: false, formError: "That document no longer exists." };
  }
  await logActivity({
    actorId: s.sub,
    action: "document.delete",
    entity: "document",
    targetId: doc.id,
    locationId: await getUserLocationId(s.sub),
    details: { original_name: doc.original_name, folder: doc.folder },
  });
  return { ok: true };
}
