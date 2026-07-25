import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/dal";
import { logActivity } from "@/lib/audit";
import {
  checkDocumentCount,
  checkDocumentFile,
  mimeForExtension,
  recordFolder,
  sanitizeFileName,
  sniffMatchesExtension,
} from "@/lib/documents/rules";
import { recordRefSchema } from "@/lib/documents/schema";
import {
  countRecordDocuments,
  createDocuments,
  getUploadTarget,
  listRecordDocuments,
} from "@/lib/documents/repository";
import { removeDocumentFileQuietly, writeDocumentFile } from "@/lib/documents/storage";

// Upload scans/case-study documents onto an OPD consultation or IPD admission.
// A route handler (not a server action) because 25 MB multipart bodies don't
// fit the action body limit. Node runtime: fs + pg.
//
// EVERY staff role may upload (the client's requirement); the checks are
// authoritative HERE regardless of what the dialog pre-validated (dev-rules §8):
// allow-listed extension, magic-byte sniff of the actual bytes, 25 MB per file,
// and 20 documents per record - the cap re-checked inside the insert
// transaction so concurrent uploads can't overshoot. Files are written to disk
// first, then the metadata rows commit atomically; if the cap loses the race
// the written files are removed again. IPD uploads are only allowed once the
// admission is discharged (the record is closed - same rule as the list UI).
export const runtime = "nodejs";

const ALL_STAFF_ROLES = ["admin", "supervisor", "op_desk", "op_ip_desk"];

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(req: NextRequest) {
  // JSON 401/403, not a redirect - the dialog calls this with fetch().
  const session = await getSession();
  if (!session) return fail(401, "Your session has expired. Please sign in again.");
  if (!ALL_STAFF_ROLES.includes(session.role)) return fail(403, "Not allowed.");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail(400, "Malformed upload.");
  }

  const ref = recordRefSchema.safeParse({
    recordType: form.get("recordType"),
    recordId: form.get("recordId"),
  });
  if (!ref.success) return fail(400, "Invalid record reference.");
  const { recordType, recordId } = ref.data;

  const files = form.getAll("files").filter((f): f is File => f instanceof File);

  const target = await getUploadTarget(recordType, recordId);
  if (!target) return fail(404, "That record no longer exists.");
  if (recordType === "ipd" && target.admissionStatus !== "discharged") {
    return fail(409, "Documents can be added only after the patient is discharged.");
  }

  // Cheap pre-check outside the transaction for a clear early error; the
  // race-proof check is inside createDocuments.
  const existing = await countRecordDocuments(recordType, recordId);
  const countCheck = checkDocumentCount(existing, files.length);
  if (!countCheck.ok) return fail(409, countCheck.error);

  // Validate every file BEFORE writing anything - a batch is all-or-nothing.
  const validated: { file: File; ext: string; safeName: string }[] = [];
  for (const file of files) {
    const check = checkDocumentFile({ name: file.name, size: file.size });
    if (!check.ok) return fail(415, `${file.name}: ${check.error}`);
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    if (!sniffMatchesExtension(check.ext, head)) {
      return fail(415, `${file.name}: the file's contents don't match its type.`);
    }
    validated.push({ file, ext: check.ext, safeName: sanitizeFileName(file.name) });
  }

  const folder = recordFolder(recordType, recordId, target.patientCode);

  // Write bytes to disk first, then commit the metadata rows in one
  // transaction. On any failure, remove what this request wrote (best-effort) -
  // a file without its DB row must not linger as a phantom.
  const written: { originalName: string; storedName: string; mimeType: string; sizeBytes: number }[] = [];
  try {
    for (const v of validated) {
      const data = Buffer.from(await v.file.arrayBuffer());
      const storedName = await writeDocumentFile(folder, v.safeName, data);
      written.push({
        originalName: v.file.name,
        storedName,
        mimeType: mimeForExtension(v.ext),
        sizeBytes: v.file.size,
      });
    }

    const created = await createDocuments({
      recordType,
      recordId,
      patientId: target.patientId,
      locationId: target.locationId,
      uploadedBy: session.sub,
      files: written.map((w) => ({
        originalName: w.originalName,
        storedName: w.storedName,
        folder,
        mimeType: w.mimeType,
        sizeBytes: w.sizeBytes,
      })),
    });
    if (!created) {
      // The 20-per-record cap lost a concurrent race - undo this batch's files.
      for (const w of written) await removeDocumentFileQuietly(folder, w.storedName);
      return fail(409, `This record already holds the maximum number of documents.`);
    }
  } catch (err) {
    for (const w of written) await removeDocumentFileQuietly(folder, w.storedName);
    console.error("[documents] upload failed:", err);
    return fail(500, "The upload could not be saved. Nothing was attached - please try again.");
  }

  await logActivity({
    actorId: session.sub,
    action: "document.upload",
    entity: recordType === "ipd" ? "admission" : "consultation",
    targetId: recordId,
    locationId: target.locationId,
    details: {
      patient_id: target.patientId,
      count: written.length,
      files: written.map((w) => w.storedName),
    },
  });

  // Return the record's full, fresh list so the dialog can simply replace its
  // state with the server's truth.
  const documents = await listRecordDocuments(recordType, recordId);
  return NextResponse.json({ ok: true, documents });
}
