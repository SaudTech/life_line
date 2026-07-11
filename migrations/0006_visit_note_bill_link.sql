-- 0006_visit_note_bill_link.sql
--
--   * visits.note - an optional per-visit note (reason/observations). Populated
--     for the first visit and for free revisits, so every visit carries context.
--   * bills.consultation_id - a real FK from a consultation bill back to its
--     consultation, so the consultations list can join the bill cleanly (until
--     now a bill was only tied to a patient + type, which is ambiguous when one
--     patient has several consultation bills). Nullable: procedure/ip bills have
--     no consultation.
--
-- Forward-only. Existing rows keep NULLs.

ALTER TABLE visits ADD COLUMN note TEXT;

ALTER TABLE bills ADD COLUMN consultation_id BIGINT REFERENCES consultations (id);
CREATE INDEX bills_consultation_idx ON bills (consultation_id);
