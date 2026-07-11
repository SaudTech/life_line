-- 0001_init.sql - initial core schema for Life Line Hospital billing.
--
-- Conventions (see DEVELOPMENT_RULES.md and PROJECT_OVERVIEW.md §10):
--   * Money is stored as integer PAISE in BIGINT columns, suffixed `_paise`.
--     ₹1 = 100 paise. Never float, never NUMERIC. The app formats to rupees
--     only for display.
--   * `location_id` is on every operational table (multi-branch-ready), even
--     though only one branch exists today. No branch *features* are built yet.
--   * Primary keys are BIGINT identity columns, EXCEPT `users.id`, which is a
--     UUID (a user reference is exposed in sessions/audit; a non-enumerable id
--     is preferable there).
--   * Timestamps are `timestamptz`, defaulting to now().
--   * Enumerated fields use TEXT + CHECK (easier to evolve via forward-only
--     migrations than native ENUM types).
--   * Nothing is hard-deleted: bills are voided, records are deactivated.
--
-- This whole file runs inside a single transaction (see scripts/migrate.mjs).

-- gen_random_uuid() is built into Postgres 13+, but pgcrypto provides it on
-- older versions too. IF NOT EXISTS makes this a no-op where it already exists.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Shared trigger to keep an `updated_at` column current on every UPDATE, so no
-- application code path can forget to bump it. Attached per-table below.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- locations - one row for now; the anchor for multi-branch readiness.
-- ---------------------------------------------------------------------------
CREATE TABLE locations (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- users - each staff member logs in individually (per-person audit trail).
-- Roles are enforced on the server, not just in the UI.
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT        NOT NULL,
  login          TEXT        NOT NULL,              -- username or phone used to sign in
  email          TEXT,                             -- optional; unique when present
  phone          TEXT,                             -- optional contact number
  password_hash  TEXT        NOT NULL,             -- scrypt hash of the login password
  pin_hash       TEXT,                             -- scrypt hash of the supervisor
                                                   -- discount-approval PIN (supervisors/
                                                   -- admins only; NULL for desk users)
  role           TEXT        NOT NULL
                   CHECK (role IN ('op_desk', 'op_ip_desk', 'supervisor', 'admin')),
  active         BOOLEAN     NOT NULL DEFAULT TRUE, -- real boolean; psql prints it as t/f
  location_id    BIGINT      NOT NULL REFERENCES locations (id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT users_login_unique UNIQUE (login),
  CONSTRAINT users_email_unique UNIQUE (email)  -- allows multiple NULLs
);

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- doctors - each has a consultation fee and a per-doctor revisit validity.
-- ---------------------------------------------------------------------------
CREATE TABLE doctors (
  id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name                  TEXT        NOT NULL,
  department            TEXT,
  fee_paise             BIGINT      NOT NULL CHECK (fee_paise >= 0),
  revisit_validity_days INTEGER     NOT NULL CHECK (revisit_validity_days >= 0),
  active                BOOLEAN     NOT NULL DEFAULT TRUE,
  location_id           BIGINT      NOT NULL REFERENCES locations (id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- services - the procedures/items list (IV, injection, etc.).
-- ---------------------------------------------------------------------------
CREATE TABLE services (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        TEXT        NOT NULL,
  price_paise BIGINT      NOT NULL CHECK (price_paise >= 0),
  active      BOOLEAN     NOT NULL DEFAULT TRUE,
  location_id BIGINT      NOT NULL REFERENCES locations (id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- patients - identified by a unique auto-generated patient_code (MRN), NEVER
-- by phone. Phone is a required contact/lookup field but is NOT unique:
-- several patients (e.g. mother + child) may share one number.
-- ---------------------------------------------------------------------------
CREATE TABLE patients (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  patient_code  TEXT        NOT NULL,               -- MRN shown to users
  name          TEXT        NOT NULL,
  age           INTEGER     CHECK (age IS NULL OR age >= 0),
  phone         TEXT,                               -- indexed, NOT unique
  area          TEXT,
  location_id   BIGINT      NOT NULL REFERENCES locations (id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT patients_code_unique UNIQUE (patient_code)
);

-- Phone lookup runs constantly at the counter; index it (non-unique).
CREATE INDEX patients_phone_idx ON patients (phone);
CREATE INDEX patients_location_idx ON patients (location_id);

-- ---------------------------------------------------------------------------
-- consultations - a paid doctor visit valid until `valid_until`. Same-doctor
-- revisits within the window reuse the consultation (see visits) with no fee.
-- ---------------------------------------------------------------------------
CREATE TABLE consultations (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  patient_id       BIGINT      NOT NULL REFERENCES patients (id),
  doctor_id        BIGINT      NOT NULL REFERENCES doctors (id),
  fee_charged_paise BIGINT     NOT NULL CHECK (fee_charged_paise >= 0),
  valid_until      DATE        NOT NULL,
  location_id      BIGINT      NOT NULL REFERENCES locations (id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX consultations_patient_idx ON consultations (patient_id);
CREATE INDEX consultations_doctor_idx ON consultations (doctor_id);

-- ---------------------------------------------------------------------------
-- visits - each recorded visit under a consultation (the first, plus free
-- same-doctor revisits within validity).
-- ---------------------------------------------------------------------------
CREATE TABLE visits (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  consultation_id BIGINT      NOT NULL REFERENCES consultations (id),
  visited_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX visits_consultation_idx ON visits (consultation_id);

-- ---------------------------------------------------------------------------
-- bills - every bill gets a unique, DB-issued bill_number BEFORE printing and
-- is never reused. Corrections are void + re-issue (never hard delete), so we
-- keep void metadata and a pointer to the replacement bill.
-- ---------------------------------------------------------------------------
CREATE SEQUENCE bill_number_seq;

CREATE TABLE bills (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bill_number          BIGINT      NOT NULL DEFAULT nextval('bill_number_seq'),
  patient_id           BIGINT      NOT NULL REFERENCES patients (id),
  type                 TEXT        NOT NULL
                         CHECK (type IN ('consultation', 'procedure', 'ip')),
  subtotal_paise       BIGINT      NOT NULL CHECK (subtotal_paise >= 0),
  discount_paise       BIGINT      NOT NULL DEFAULT 0 CHECK (discount_paise >= 0),
  total_paise          BIGINT      NOT NULL CHECK (total_paise >= 0),
  status               TEXT        NOT NULL DEFAULT 'final'
                         CHECK (status IN ('final', 'pending_approval', 'void')),
  payment_mode         TEXT        CHECK (payment_mode IN ('cash', 'card', 'upi', 'other')),
  discount_approved_by UUID        REFERENCES users (id),  -- supervisor who approved
  created_by           UUID        NOT NULL REFERENCES users (id),
  voided_by            UUID        REFERENCES users (id),
  voided_at            TIMESTAMPTZ,
  void_reason          TEXT,
  replaced_by_bill_id  BIGINT      REFERENCES bills (id),  -- the re-issued bill
  location_id          BIGINT      NOT NULL REFERENCES locations (id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT bills_number_unique UNIQUE (bill_number),
  -- A discount can only exist on a bill that has an approver recorded.
  CONSTRAINT bills_discount_needs_approval
    CHECK (discount_paise = 0 OR discount_approved_by IS NOT NULL)
);

CREATE INDEX bills_created_at_idx ON bills (created_at);
CREATE INDEX bills_patient_idx ON bills (patient_id);
CREATE INDEX bills_created_by_idx ON bills (created_by);
CREATE INDEX bills_status_idx ON bills (status);
CREATE INDEX bills_location_idx ON bills (location_id);

-- ---------------------------------------------------------------------------
-- bill_items - itemised lines. service_id is nullable so a free-text line
-- (with its own description/price) is possible; line_total is stored, not
-- trusted to be recomputed on read.
-- ---------------------------------------------------------------------------
CREATE TABLE bill_items (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bill_id          BIGINT  NOT NULL REFERENCES bills (id),
  service_id       BIGINT  REFERENCES services (id),
  description      TEXT    NOT NULL,
  quantity         INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_paise BIGINT  NOT NULL CHECK (unit_price_paise >= 0),
  line_total_paise BIGINT  NOT NULL CHECK (line_total_paise >= 0)
);

CREATE INDEX bill_items_bill_idx ON bill_items (bill_id);

-- ---------------------------------------------------------------------------
-- admissions - in-patient stay. Advance taken at admission; room charge and
-- discharge time filled on discharge. Payable balance is computed by the
-- billing rules, not stored here.
-- ---------------------------------------------------------------------------
CREATE TABLE admissions (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  patient_id        BIGINT      NOT NULL REFERENCES patients (id),
  admitted_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  discharged_at     TIMESTAMPTZ,
  advance_paid_paise BIGINT     NOT NULL DEFAULT 0 CHECK (advance_paid_paise >= 0),
  room_charge_paise BIGINT      NOT NULL DEFAULT 0 CHECK (room_charge_paise >= 0),
  status            TEXT        NOT NULL DEFAULT 'admitted'
                      CHECK (status IN ('admitted', 'discharged')),
  location_id       BIGINT      NOT NULL REFERENCES locations (id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX admissions_patient_idx ON admissions (patient_id);
CREATE INDEX admissions_status_idx ON admissions (status);

-- ---------------------------------------------------------------------------
-- admission_expenses - itemised discharge expenses for an admission.
-- ---------------------------------------------------------------------------
CREATE TABLE admission_expenses (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  admission_id BIGINT  NOT NULL REFERENCES admissions (id),
  item         TEXT    NOT NULL,
  quantity     INTEGER NOT NULL CHECK (quantity > 0),
  total_paise  BIGINT  NOT NULL CHECK (total_paise >= 0)
);

CREATE INDEX admission_expenses_admission_idx ON admission_expenses (admission_id);

-- ---------------------------------------------------------------------------
-- audit_log - who did what, when. Append-only.
-- ---------------------------------------------------------------------------
CREATE TABLE audit_log (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    UUID        REFERENCES users (id),
  action     TEXT        NOT NULL,          -- e.g. 'bill.void', 'discount.approve'
  entity     TEXT        NOT NULL,          -- e.g. 'bill', 'patient'
  entity_id  BIGINT,
  details    JSONB,                         -- optional structured context
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_entity_idx ON audit_log (entity, entity_id);
CREATE INDEX audit_log_user_idx ON audit_log (user_id);
CREATE INDEX audit_log_at_idx ON audit_log (at);
