-- 0005_consultation_intake.sql - extra intake fields for the OPD consultation flow.
--
--   * patients.gender  - captured at registration, shown in the patient picker.
--   * consultations.reason - the reason for visit / symptoms noted at booking.
--
-- Both are optional (nullable) - existing rows predate them and stay valid.
-- Forward-only.

ALTER TABLE patients
  ADD COLUMN gender TEXT
  CHECK (gender IS NULL OR gender IN ('female', 'male', 'other'));

ALTER TABLE consultations
  ADD COLUMN reason TEXT;
