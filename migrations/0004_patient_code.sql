-- 0004_patient_code.sql - auto-generate the patient MRN (patient_code).
--
-- patients.patient_code (0001) is UNIQUE with no default, so the app had to supply
-- it. Generating it in app code is racy (two counters can collide) and puts a
-- money-adjacent identifier in the UI layer. Instead the DB mints it: a dedicated
-- sequence + a column DEFAULT so every INSERT gets a unique, sequential MRN with
-- no app logic. createPatient inserts WITHOUT patient_code and RETURNs the value.
--
-- Format: 'LL' || 6-digit zero-padded sequence → LL000001, LL000002, …
-- ('LL' = Life Line; a per-location prefix is a later concern.)
-- Forward-only. Existing rows (dev only) keep their current codes.

CREATE SEQUENCE patient_code_seq;

ALTER TABLE patients
  ALTER COLUMN patient_code
  SET DEFAULT 'LL' || lpad(nextval('patient_code_seq')::text, 6, '0');
