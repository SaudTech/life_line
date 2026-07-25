// Pure document-upload rules - the ONE source of truth for what may be attached
// to an OPD consultation or IPD admission (dev-rules §2: pure, no DB, no UI, no
// fs). Client-safe: the upload dialog uses these for instant pre-checks, and the
// upload route re-runs the SAME functions authoritatively - never two versions
// of a limit. Every function here is unit-tested (rules.test.ts).

export type DocumentRecordType = "opd" | "ipd";

// Hard limits. 20 documents TOTAL per consultation/admission (not per batch),
// 25 MB per file - enough for multi-page scans without letting one upload
// swallow the disk.
export const MAX_DOCUMENTS_PER_RECORD = 20;
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

// The allow-list: extension -> the MIME types browsers commonly report for it.
// Scans and case studies arrive as PDFs, photos/scanned images, or Office
// documents. Deliberately NO svg/html/exe - nothing a browser could execute.
export const ALLOWED_DOCUMENT_TYPES: Record<string, { label: string; mimes: readonly string[] }> = {
  pdf:  { label: "PDF",   mimes: ["application/pdf"] },
  jpg:  { label: "Image", mimes: ["image/jpeg"] },
  jpeg: { label: "Image", mimes: ["image/jpeg"] },
  png:  { label: "Image", mimes: ["image/png"] },
  webp: { label: "Image", mimes: ["image/webp"] },
  gif:  { label: "Image", mimes: ["image/gif"] },
  bmp:  { label: "Image", mimes: ["image/bmp", "image/x-ms-bmp"] },
  tif:  { label: "Image", mimes: ["image/tiff"] },
  tiff: { label: "Image", mimes: ["image/tiff"] },
  doc:  { label: "Word",  mimes: ["application/msword"] },
  docx: { label: "Word",  mimes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"] },
  xls:  { label: "Excel", mimes: ["application/vnd.ms-excel"] },
  xlsx: { label: "Excel", mimes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"] },
  csv:  { label: "Text",  mimes: ["text/csv"] },
  txt:  { label: "Text",  mimes: ["text/plain"] },
};

// `accept` attribute for the file input, derived from the one allow-list above.
export const DOCUMENT_ACCEPT = Object.keys(ALLOWED_DOCUMENT_TYPES)
  .map((ext) => `.${ext}`)
  .join(",");

// Lower-cased extension of a file name (without the dot), or null when there
// isn't one. "report.final.PDF" -> "pdf"; "scan" / ".hidden" -> null.
export function fileExtension(name: string): string | null {
  const base = name.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return null;
  return base.slice(dot + 1).toLowerCase();
}

// The stored MIME type for an allowed extension - authoritative over whatever
// the browser claimed, so the preview/download route always serves a type we
// chose, never an attacker-supplied one.
export function mimeForExtension(ext: string): string {
  return ALLOWED_DOCUMENT_TYPES[ext]?.mimes[0] ?? "application/octet-stream";
}

export type FileCheck = { ok: true; ext: string } | { ok: false; error: string };

// Validate ONE candidate file by name + size. Pure, so the dialog can reject a
// bad pick instantly and the server re-runs the exact same check on the bytes
// it actually received.
export function checkDocumentFile(file: { name: string; size: number }): FileCheck {
  const ext = fileExtension(file.name);
  if (!ext || !(ext in ALLOWED_DOCUMENT_TYPES)) {
    return {
      ok: false,
      error: "This file type is not allowed. Use PDF, images, Word, Excel, or plain text.",
    };
  }
  if (file.size <= 0) {
    return { ok: false, error: "This file is empty." };
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    return { ok: false, error: `Larger than the ${formatBytes(MAX_DOCUMENT_BYTES)} limit.` };
  }
  return { ok: true, ext };
}

// Would adding `adding` files to a record that already holds `existingCount`
// break the 20-per-record cap?
export function checkDocumentCount(
  existingCount: number,
  adding: number,
): { ok: true } | { ok: false; error: string } {
  if (adding < 1) return { ok: false, error: "Choose at least one file." };
  if (existingCount + adding > MAX_DOCUMENTS_PER_RECORD) {
    const room = Math.max(0, MAX_DOCUMENTS_PER_RECORD - existingCount);
    return {
      ok: false,
      error:
        room === 0
          ? `This record already holds the maximum of ${MAX_DOCUMENTS_PER_RECORD} documents.`
          : `Only ${room} more ${room === 1 ? "document" : "documents"} can be added (limit ${MAX_DOCUMENTS_PER_RECORD}).`,
    };
  }
  return { ok: true };
}

// Does the file's leading bytes actually look like its extension claims?
// Extension + browser MIME are trivially forged; the server checks the magic
// numbers of everything it accepts. docx/xlsx are ZIP containers and legacy
// doc/xls are OLE containers - the check pins the container family, which is
// as far as magic bytes can distinguish them. txt/csv have no signature, so
// they only need to look like text (no NUL bytes in the head).
export function sniffMatchesExtension(ext: string, head: Uint8Array): boolean {
  const startsWith = (...bytes: number[]) =>
    head.length >= bytes.length && bytes.every((b, i) => head[i] === b);
  switch (ext) {
    case "pdf":
      return startsWith(0x25, 0x50, 0x44, 0x46); // %PDF
    case "jpg":
    case "jpeg":
      return startsWith(0xff, 0xd8, 0xff);
    case "png":
      return startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case "webp":
      return (
        startsWith(0x52, 0x49, 0x46, 0x46) && // RIFF
        head.length >= 12 &&
        head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50 // WEBP
      );
    case "gif":
      return startsWith(0x47, 0x49, 0x46, 0x38); // GIF8
    case "bmp":
      return startsWith(0x42, 0x4d); // BM
    case "tif":
    case "tiff":
      return startsWith(0x49, 0x49, 0x2a, 0x00) || startsWith(0x4d, 0x4d, 0x00, 0x2a);
    case "docx":
    case "xlsx":
      return startsWith(0x50, 0x4b, 0x03, 0x04); // PK.. (ZIP)
    case "doc":
    case "xls":
      return startsWith(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1); // OLE2
    case "txt":
    case "csv":
      return head.length > 0 && !head.some((b) => b === 0x00);
    default:
      return false;
  }
}

// Windows-reserved device names - a file literally named "con.pdf" would break
// the on-disk store, so these bases get a prefix.
const RESERVED_BASES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

// Turn an arbitrary user file name into a safe Windows file name, keeping it
// recognisable: path segments dropped, forbidden characters replaced with "_",
// trailing dots/spaces trimmed, reserved device names prefixed, and the whole
// name capped at 120 chars with the extension preserved.
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const ext = fileExtension(base);
  const stemRaw = ext ? base.slice(0, base.length - ext.length - 1) : base;
  // Forbidden on Windows: < > : " | ? * plus control characters (code < 32).
  let stem = Array.from(stemRaw, (ch) =>
    ch < " " || '<>:"|?*'.includes(ch) ? "_" : ch,
  )
    .join("")
    .replace(/[.\s]+$/g, "")
    .trim();
  if (stem === "") stem = "document";
  if (RESERVED_BASES.test(stem)) stem = `_${stem}`;
  const suffix = ext ? `.${ext}` : "";
  const maxStem = 120 - suffix.length;
  if (stem.length > maxStem) stem = stem.slice(0, maxStem);
  return `${stem}${suffix}`;
}

// The on-disk folder for one record, relative to the documents root:
// IPD admissions  -> IPD/ADM-<id>_<patient code>
// OPD consultations -> OPD/CONS-<id>_<patient code>
// Record id + patient code so staff browsing the drive can find a patient's
// folder by eye. patient_code is app-generated but sanitised anyway.
export function recordFolder(
  recordType: DocumentRecordType,
  recordId: string,
  patientCode: string,
): string {
  const safeCode = patientCode.replace(/[^A-Za-z0-9_-]/g, "_") || "UNKNOWN";
  return recordType === "ipd" ? `IPD/ADM-${recordId}_${safeCode}` : `OPD/CONS-${recordId}_${safeCode}`;
}

// Human-readable size for the dialog rows ("2.4 MB"). Display only.
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Can this type be previewed in a browser tab (vs download-only)? PDFs and
// images render natively; Word/Excel/CSV do not.
export function isPreviewableExtension(ext: string | null): boolean {
  if (!ext) return false;
  return ext === "pdf" || ALLOWED_DOCUMENT_TYPES[ext]?.label === "Image";
}
