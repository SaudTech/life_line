-- 0015_bill_template_types.sql - widen bill_templates.bill_type to add the two new
-- template kinds (print-updates plan §4a): `advance` and `end_day`.
--
--   • end_day - the daily close-out is now a first-class designable template,
--     printed through the same pipeline as bills (it ships a checked-in default).
--   • advance - added so the print-button gate (hasPrintableTemplate) can treat it
--     uniformly; it ships NO default, so it stays button-less until an owner asks
--     for a designed advance receipt (plan §5).
--
-- Forward-only: the CHECK from 0010 was defined inline (unnamed), so Postgres named
-- it bill_templates_bill_type_check. Drop and re-add it widened. No data changes -
-- existing rows are all consultation/procedure/ip, which stay valid.

ALTER TABLE bill_templates DROP CONSTRAINT bill_templates_bill_type_check;
ALTER TABLE bill_templates ADD  CONSTRAINT bill_templates_bill_type_check
  CHECK (bill_type IN ('consultation', 'procedure', 'ip', 'advance', 'end_day'));
