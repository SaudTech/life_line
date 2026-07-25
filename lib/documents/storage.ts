import { mkdir, readFile, writeFile, unlink, access } from "fs/promises";
import path from "path";

// Filesystem layer for patient documents - the ONLY module that touches the
// documents disk store. Server-only (fs); imported by the upload/serve routes,
// never by client code. The DB row (lib/documents/repository.ts) is the source
// of truth for WHAT exists; this module only puts bytes at the path the row
// describes and reads them back.
//
// Layout (per the client's requirement): a configurable parent from .env -
// DOCUMENTS_ROOT, typically a drive like D:\ - under which the app creates
//   Life_Line_Hospital_Documents\
//     IPD\ADM-<id>_<patient code>\   one folder per admission
//     OPD\CONS-<id>_<patient code>\  one folder per consultation
// Folders are created on first use; staff can browse the drive directly.

const BASE_FOLDER = "Life_Line_Hospital_Documents";

// Resolve the store root. DOCUMENTS_ROOT unset falls back to C:\ (the app must
// still work on a machine with no D: drive); the base folder name is fixed.
export function documentsRoot(): string {
  const parent = process.env.DOCUMENTS_ROOT?.trim() || "C:\\";
  return path.join(parent, BASE_FOLDER);
}

// Absolute path of a stored document, with a traversal guard: whatever the DB
// row says, the resolved path must stay inside the documents root. folder and
// storedName come from our own sanitised writes, but a defence-in-depth check
// costs nothing next to a disk read.
export function resolveDocumentPath(folder: string, storedName: string): string {
  const root = documentsRoot();
  const abs = path.resolve(root, folder, storedName);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (!abs.startsWith(rootWithSep)) {
    throw new Error("Document path escapes the documents root.");
  }
  return abs;
}

// Write one uploaded file into a record folder (created if missing). The
// desired name is already sanitised (rules.sanitizeFileName); if a file with
// that name already exists in the folder, a numeric suffix is added
// (scan.pdf -> scan_2.pdf -> scan_3.pdf ...) so nothing is ever overwritten.
// Returns the name actually stored, for the DB row.
export async function writeDocumentFile(
  folder: string,
  desiredName: string,
  data: Buffer,
): Promise<string> {
  const dir = path.resolve(documentsRoot(), folder);
  await mkdir(dir, { recursive: true });

  const ext = path.extname(desiredName); // ".pdf" or ""
  const stem = desiredName.slice(0, desiredName.length - ext.length);
  let storedName = desiredName;
  for (let n = 2; await fileExists(path.join(dir, storedName)); n++) {
    storedName = `${stem}_${n}${ext}`;
    if (n > 500) throw new Error("Could not find a free file name."); // can't happen at 20 files/record
  }

  await writeFile(path.join(dir, storedName), data, { flag: "wx" });
  return storedName;
}

// Read a stored document fully into memory (files are capped at 25 MB and
// traffic is a LAN counter - buffering whole files is the simple, boring choice,
// dev-rules §1.5). Returns null when the file is missing on disk (e.g. someone
// moved it by hand) so the route can answer 404 instead of throwing.
export async function readDocumentFile(folder: string, storedName: string): Promise<Buffer | null> {
  try {
    return await readFile(resolveDocumentPath(folder, storedName));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

// Best-effort cleanup for files written in a batch whose DB insert then failed
// (e.g. the 20-file cap lost a race). Removing an already-motherless file must
// never mask the original error, so failures are swallowed.
export async function removeDocumentFileQuietly(folder: string, storedName: string): Promise<void> {
  try {
    await unlink(resolveDocumentPath(folder, storedName));
  } catch {
    // best-effort only
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}
