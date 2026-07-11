-- 0010_printing.sql - foundation for the admin receipt/report builder.
--
-- Two tables:
--
--   * hospital_profile - the A4 receipt letterhead (locations only has `name`
--     today; a receipt needs address/phone/GST too). One row per location.
--     Seeded here for the default (first) location so printing works day one.
--
--   * bill_templates - the pdfme Template JSON an admin designs per bill type
--     (consultation | procedure | ip), per location. `schema_json` holds the
--     pdfme Template (basePdf + schemas). Only one ACTIVE template per
--     (bill_type, location_id) at a time - enforced by a partial unique index -
--     so "the" template for a type/location is always an unambiguous single row.
--     Past versions are kept (is_active = false) rather than deleted, so a bad
--     save can be recovered by an admin re-activating an older row if ever needed.
--
-- Forward-only.

CREATE TABLE hospital_profile (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  location_id  BIGINT      NOT NULL REFERENCES locations (id),
  name         TEXT        NOT NULL,
  address      TEXT,
  phone        TEXT,
  gstin        TEXT,
  footer_note  TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   UUID        REFERENCES users (id),
  CONSTRAINT hospital_profile_location_unique UNIQUE (location_id)
);

CREATE TRIGGER hospital_profile_set_updated_at
  BEFORE UPDATE ON hospital_profile
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Seed the default (first, and today only) location so the resolver always has
-- a letterhead to read, even before an admin ever visits a settings screen.
INSERT INTO hospital_profile (location_id, name)
SELECT id, name FROM locations ORDER BY id ASC LIMIT 1;

CREATE TABLE bill_templates (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  location_id  BIGINT      NOT NULL REFERENCES locations (id),
  bill_type    TEXT        NOT NULL CHECK (bill_type IN ('consultation', 'procedure', 'ip')),
  name         TEXT        NOT NULL,
  schema_json  JSONB       NOT NULL,
  is_active    BOOLEAN     NOT NULL DEFAULT TRUE,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   UUID        REFERENCES users (id)
);

CREATE TRIGGER bill_templates_set_updated_at
  BEFORE UPDATE ON bill_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Exactly one active template per (bill_type, location_id) - a save deactivates
-- the prior active row and inserts a new one, never an UPDATE-in-place, so
-- "reset to default" can always fall back to seeding a fresh active row.
CREATE UNIQUE INDEX bill_templates_active_unique
  ON bill_templates (bill_type, location_id)
  WHERE is_active;

CREATE INDEX bill_templates_location_idx ON bill_templates (location_id);
