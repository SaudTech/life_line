import { pool } from "@/lib/db";
import {
  MAX_DOCUMENTS_PER_RECORD,
  type DocumentRecordType,
} from "./rules";

// Data-access layer for patient documents (metadata only - the bytes live on
// disk, lib/documents/storage.ts). Thin queries, no business decisions beyond
// the transactional 20-per-record cap that must live next to the INSERT to be
// race-proof.

// One document row as the UI lists it: joined with the uploader's name and the
// upload time pre-formatted in the clinic tz (same pattern as the admissions
// list labels), so "who uploaded this, when" is one query and the client only
// displays.
export interface DocumentListRow {
  id: string;
  record_type: DocumentRecordType;
  consultation_id: string | null;
  admission_id: string | null;
  patient_id: string;
  original_name: string;
  stored_name: string;
  folder: string;
  mime_type: string;
  size_bytes: string;
  uploaded_by_name: string;
  uploaded_label: string;
}

const LIST_SELECT = `
  SELECT d.id, d.record_type, d.consultation_id, d.admission_id, d.patient_id,
         d.original_name, d.stored_name, d.folder, d.mime_type, d.size_bytes,
         u.name AS uploaded_by_name,
         to_char(d.created_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM') AS uploaded_label
    FROM patient_documents d
    JOIN users u ON u.id = d.uploaded_by`;

// Documents attached to one record, oldest first (upload order - the order a
// case file reads in). Soft-deleted rows never appear.
export async function listRecordDocuments(
  recordType: DocumentRecordType,
  recordId: string,
): Promise<DocumentListRow[]> {
  const column = recordType === "ipd" ? "admission_id" : "consultation_id";
  const { rows } = await pool.query<DocumentListRow>(
    `${LIST_SELECT}
      WHERE d.${column} = $1 AND d.deleted_at IS NULL
      ORDER BY d.created_at, d.id`,
    [recordId],
  );
  return rows;
}

// Every live document for one patient, across all their consultations and
// admissions - the admin patient view. Newest record first.
export async function listPatientDocuments(patientId: string): Promise<DocumentListRow[]> {
  const { rows } = await pool.query<DocumentListRow>(
    `${LIST_SELECT}
      WHERE d.patient_id = $1 AND d.deleted_at IS NULL
      ORDER BY COALESCE(d.admission_id, d.consultation_id) DESC, d.record_type, d.created_at, d.id`,
    [patientId],
  );
  return rows;
}

// One document with everything the serve route needs. Includes deleted_at so
// the route can refuse a soft-deleted document explicitly.
export interface DocumentFileRow {
  id: string;
  original_name: string;
  stored_name: string;
  folder: string;
  mime_type: string;
  location_id: string;
  deleted_at: Date | null;
}

export async function getDocument(id: string): Promise<DocumentFileRow | null> {
  const { rows } = await pool.query<DocumentFileRow>(
    `SELECT id, original_name, stored_name, folder, mime_type, location_id, deleted_at
       FROM patient_documents WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

// The upload target: does the record exist, whose patient is it, and (for IPD)
// what status is it in? One query per record type; the route decides from this
// whether uploads are allowed (IPD only once discharged).
export interface UploadTarget {
  recordId: string;
  patientId: string;
  patientCode: string;
  patientName: string;
  locationId: string;
  admissionStatus: string | null; // null for OPD
}

export async function getUploadTarget(
  recordType: DocumentRecordType,
  recordId: string,
): Promise<UploadTarget | null> {
  const sql =
    recordType === "ipd"
      ? `SELECT a.id AS record_id, p.id AS patient_id, p.patient_code, p.name AS patient_name,
                a.location_id, a.status AS admission_status
           FROM admissions a JOIN patients p ON p.id = a.patient_id
          WHERE a.id = $1`
      : `SELECT c.id AS record_id, p.id AS patient_id, p.patient_code, p.name AS patient_name,
                c.location_id, NULL AS admission_status
           FROM consultations c JOIN patients p ON p.id = c.patient_id
          WHERE c.id = $1`;
  const { rows } = await pool.query<{
    record_id: string;
    patient_id: string;
    patient_code: string;
    patient_name: string;
    location_id: string;
    admission_status: string | null;
  }>(sql, [recordId]);
  const r = rows[0];
  if (!r) return null;
  return {
    recordId: r.record_id,
    patientId: r.patient_id,
    patientCode: r.patient_code,
    patientName: r.patient_name,
    locationId: r.location_id,
    admissionStatus: r.admission_status,
  };
}

export async function countRecordDocuments(
  recordType: DocumentRecordType,
  recordId: string,
): Promise<number> {
  const column = recordType === "ipd" ? "admission_id" : "consultation_id";
  const { rows } = await pool.query<{ n: string }>(
    `SELECT count(*) AS n FROM patient_documents WHERE ${column} = $1 AND deleted_at IS NULL`,
    [recordId],
  );
  return Number(rows[0].n);
}

export interface CreateDocumentFileInput {
  originalName: string;
  storedName: string;
  folder: string;
  mimeType: string;
  sizeBytes: number;
}

export interface CreateDocumentsInput {
  recordType: DocumentRecordType;
  recordId: string;
  patientId: string;
  locationId: string;
  uploadedBy: string;
  files: CreateDocumentFileInput[];
}

// Insert one batch of document rows atomically, re-checking the 20-per-record
// cap INSIDE the transaction under a lock on the parent record - two counters
// uploading to the same record at once cannot overshoot the cap (dev-rules §4:
// multi-step writes save fully or not at all). Returns the new ids, or null
// when the cap would be exceeded (caller removes the already-written files).
export async function createDocuments(input: CreateDocumentsInput): Promise<{ ids: string[] } | null> {
  const parentTable = input.recordType === "ipd" ? "admissions" : "consultations";
  const column = input.recordType === "ipd" ? "admission_id" : "consultation_id";
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Serialise concurrent uploads to the same record.
    await client.query(`SELECT id FROM ${parentTable} WHERE id = $1 FOR UPDATE`, [input.recordId]);
    const { rows: countRows } = await client.query<{ n: string }>(
      `SELECT count(*) AS n FROM patient_documents WHERE ${column} = $1 AND deleted_at IS NULL`,
      [input.recordId],
    );
    if (Number(countRows[0].n) + input.files.length > MAX_DOCUMENTS_PER_RECORD) {
      await client.query("ROLLBACK");
      return null;
    }
    const ids: string[] = [];
    for (const f of input.files) {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO patient_documents
           (record_type, consultation_id, admission_id, patient_id, original_name,
            stored_name, folder, mime_type, size_bytes, uploaded_by, location_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id`,
        [
          input.recordType,
          input.recordType === "opd" ? input.recordId : null,
          input.recordType === "ipd" ? input.recordId : null,
          input.patientId,
          f.originalName,
          f.storedName,
          f.folder,
          f.mimeType,
          f.sizeBytes,
          input.uploadedBy,
          input.locationId,
        ],
      );
      ids.push(rows[0].id);
    }
    await client.query("COMMIT");
    return { ids };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Soft-delete one document (admin only, enforced by the action). The row and
// the file on disk both remain - nothing is silently destroyed (dev-rules §4).
// Returns true when a live row was actually stamped.
export async function softDeleteDocument(id: string, deletedBy: string): Promise<boolean> {
  const res = await pool.query(
    `UPDATE patient_documents
        SET deleted_at = now(), deleted_by = $2
      WHERE id = $1 AND deleted_at IS NULL`,
    [id, deletedBy],
  );
  return res.rowCount === 1;
}
