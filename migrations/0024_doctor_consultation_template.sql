-- 0024_doctor_consultation_template.sql - per-doctor consultation receipt design.
--
-- A hospital may want one doctor's consultation receipt to print on a different
-- layout (own letterhead, own footer) than the counter's standard one. Rather
-- than a new bill_type or a versioned template, a doctor simply POINTS AT one of
-- the existing `consultation` designs in bill_templates:
--
--   * NULL (the default)  - print the location's ACTIVE consultation design,
--                           exactly as before. Nothing changes for a doctor who
--                           has never been given a custom design.
--   * a template id       - print THAT design for this doctor's consultations.
--
-- Many doctors may share one design; a doctor has at most one (it's a single
-- column, so the invariant is free - no join table, no uniqueness constraint).
--
-- The FK guarantees the row exists, but it CANNOT enforce that the target is a
-- `consultation` design at the doctor's own location - that is checked on write
-- (lib/doctors/actions.ts) and re-checked on read (isUsableConsultationTemplate,
-- lib/printing/consultation-template.ts), so a mis-pointed row degrades to the
-- default design instead of printing a procedure/IP layout for a consultation.
--
-- Resolution is LIVE, not snapshotted: a reprint uses whatever design the doctor
-- points at today, which is how editing the active design has always behaved.
--
-- Deleting a design that doctors use is allowed but never silent - the admin is
-- warned by name in the confirm dialog, and deleteTemplate() clears the pointers
-- in the same transaction (those doctors fall back to the default design).
--
-- Forward-only.

ALTER TABLE doctors ADD COLUMN consultation_template_id BIGINT REFERENCES bill_templates (id);

-- Supports the reverse lookup: "which doctors use this design?" - read by the
-- library's usage badge and by the delete warning.
CREATE INDEX doctors_consultation_template_idx
  ON doctors (consultation_template_id)
  WHERE consultation_template_id IS NOT NULL;
