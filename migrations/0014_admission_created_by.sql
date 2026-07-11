-- 0014_admission_created_by.sql - attribute the admission (and its advance) to the
-- user who took it, so the advance cash is first-class attributable money like a
-- bill (daily "what I did" report, plan §2).
--
-- admissions.advance_payment_mode already exists (0012); the missing piece is WHO
-- collected the advance. Add created_by so the report can attribute "advances I
-- took today" (admissions.created_by = me) and split them by advance_payment_mode.
--
-- Nullable: older rows predate the column (forward-only, never back-fabricated).
-- Indexed like bills.created_by, since the report filters admissions by it.

ALTER TABLE admissions
  ADD COLUMN created_by UUID REFERENCES users (id);

CREATE INDEX admissions_created_by_idx ON admissions (created_by);
