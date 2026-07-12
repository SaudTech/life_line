-- 0016_doctor_details.sql - add a phone number and an on-duty status to doctors.
--
-- `status` is separate from the existing `active` flag: `active` controls
-- whether the doctor can be picked for a NEW consultation at all (never
-- hard-deleted, deactivate-only per plan D); `status` is the doctor's current
-- duty state (available / on leave / unavailable) shown alongside it. Both can
-- be true independently - an active doctor can be on leave today.
--
-- `department` stays free TEXT here (unchanged) - it becomes a fixed dropdown
-- and REQUIRED only at the app layer (lib/doctors/schema.ts), so existing rows
-- never need a backfill; only new writes are constrained.

ALTER TABLE doctors ADD COLUMN phone  TEXT;
ALTER TABLE doctors ADD COLUMN status TEXT NOT NULL DEFAULT 'available'
  CHECK (status IN ('available', 'on_leave', 'unavailable'));
