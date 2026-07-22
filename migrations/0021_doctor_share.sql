-- 0021_doctor_share.sql - add the doctor's share of the consultation fee.
--
-- A doctor's share can be quoted either way at intake time - "40%" or "flat
-- ₹500" - so both a type flag and both value columns are stored, mirroring the
-- existing percent-OR-amount discount pattern (lib/billing/discount.ts): only
-- the column matching `share_type` is populated, the other stays NULL.
--
-- `share_percentage` is a whole number 0-100 (same convention as
-- discountPct across consultations/procedures/admissions - lib/*/schema.ts).
-- `share_flat_paise` is integer minor units, never a float (DEVELOPMENT_RULES
-- §1), matching `fee_paise`.
--
-- Defaulted to ('percentage', 0, NULL) so every existing doctor row backfills
-- to "no share configured yet" without needing app-layer null handling.

ALTER TABLE doctors ADD COLUMN share_type TEXT NOT NULL DEFAULT 'percentage'
  CHECK (share_type IN ('percentage', 'flat'));
ALTER TABLE doctors ADD COLUMN share_percentage INTEGER NOT NULL DEFAULT 0
  CHECK (share_percentage BETWEEN 0 AND 100);
ALTER TABLE doctors ADD COLUMN share_flat_paise BIGINT;
