-- 0023_patient_documents.sql
--
-- Scanned reports / case-study documents attached to an OPD consultation or an
-- IPD admission. The FILES live on disk under the configurable documents root
-- (.env DOCUMENTS_ROOT -> <root>\Life_Line_Hospital_Documents\{OPD,IPD}\<record folder>,
-- see lib/documents/storage.ts); this table is the metadata + attribution source
-- of truth: what was uploaded, to which record, by whom, and when. The hard
-- limits (20 files per record, 25 MB per file, allow-listed types) are enforced
-- server-side by lib/documents/rules.ts - never here alone, never only in the UI.
--
-- Nothing is ever hard-deleted (dev-rules §4): an admin "delete" only stamps
-- deleted_at/deleted_by; the row AND the file on disk both remain. Every list
-- query filters deleted_at IS NULL. Forward-only.

CREATE TABLE patient_documents (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  record_type     TEXT        NOT NULL CHECK (record_type IN ('opd', 'ipd')),
  -- Exactly ONE parent: an OPD row points at a consultation, an IPD row at an
  -- admission (enforced below). patient_id is denormalised from that parent so
  -- the admin "all documents for this patient" view is one indexed query.
  consultation_id BIGINT      REFERENCES consultations (id),
  admission_id    BIGINT      REFERENCES admissions (id),
  patient_id      BIGINT      NOT NULL REFERENCES patients (id),
  original_name   TEXT        NOT NULL,  -- the name the staff member's file had
  stored_name     TEXT        NOT NULL,  -- sanitised on-disk name inside `folder`
  folder          TEXT        NOT NULL,  -- record folder relative to the documents root, e.g. 'OPD/CONS-12_LLH-0045'
  mime_type       TEXT        NOT NULL,
  size_bytes      BIGINT      NOT NULL CHECK (size_bytes > 0),
  uploaded_by     UUID        NOT NULL REFERENCES users (id),
  location_id     BIGINT      NOT NULL REFERENCES locations (id),
  deleted_at      TIMESTAMPTZ,           -- soft delete only (admin), audit-logged
  deleted_by      UUID        REFERENCES users (id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT patient_documents_one_parent CHECK (
    (record_type = 'opd' AND consultation_id IS NOT NULL AND admission_id IS NULL) OR
    (record_type = 'ipd' AND admission_id IS NOT NULL AND consultation_id IS NULL)
  )
);

CREATE INDEX patient_documents_consultation_idx ON patient_documents (consultation_id) WHERE consultation_id IS NOT NULL;
CREATE INDEX patient_documents_admission_idx    ON patient_documents (admission_id)    WHERE admission_id IS NOT NULL;
CREATE INDEX patient_documents_patient_idx      ON patient_documents (patient_id);
