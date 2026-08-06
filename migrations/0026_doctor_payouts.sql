-- 0026_doctor_payouts.sql - record that a doctor's consultations have been PAID OUT.
--
-- The problem this closes. Migration 0025 froze WHAT each consultation owes a doctor,
-- and the doctor-earnings sheet can total any window of them. Neither records that
-- the money was ever handed over. So: OP Desk 1 pays Dr Khalid for his 12:00-14:00
-- sitting at 2pm. At 8pm OP Desk 2 opens the same screen, sees the whole day - all
-- thirteen consultations, including the four already settled - and pays again. No
-- warning, no trace, and nothing in the system can tell the two payments apart from
-- one payment and one reprint.
--
-- A payout is therefore a RECORD, written once and never recomputed:
--
--   doctor_payouts       - one settlement: the doctor, the frozen amount, how many
--                          consultations it covered, WHO paid it and WHEN.
--   doctor_payout_bills  - exactly which consultation bills that settlement covered.
--
-- THE GUARANTEE. `doctor_payout_bills_one_active` is a UNIQUE index on bill_id over
-- live rows: a consultation bill can belong to at most ONE live payout. Paying the
-- same consultation twice is not "discouraged by the UI" or "prevented if staff are
-- careful" - it is rejected by the database, which is the only kind of guarantee
-- worth having at a counter that runs 144 times a day. Two desks clicking at the same
-- instant is the same story: the second transaction violates the index and rolls back.
--
-- WHY THE JOIN TABLE AND NOT A COLUMN ON bills. A column would answer "is this bill
-- paid" but would have to be nulled to undo a payout, erasing the fact that it ever
-- happened. Corrections here follow the same rule as bills (PROJECT_OVERVIEW §6):
-- nothing is deleted, a payout is VOIDED. Hence voided_at/voided_by/void_reason,
-- mirroring the bills table one for one, and `active` on the link rows - cleared in
-- the same transaction as the void, which releases those consultations to be paid
-- again while the original payout stays on the record in full.
--
-- (The void PATH is not built in the UI yet - marking as paid is. The columns and the
-- partial index are here from the start because the uniqueness rule is defined in
-- terms of them: bolting "active" on later would mean rebuilding the one constraint
-- the whole feature rests on, against live payout data.)
--
-- `paid_paise` is the frozen sum of the covered bills' doctor_share_paise at the
-- moment of payment - stored, not derived, for exactly the reason 0025 exists. It is
-- integer paise (§1). `covers_label` is the window wording the slip carried
-- ("12:04 pm to 1:56 pm"), kept verbatim so a reprint can never re-word what was paid.
--
-- Forward-only. No backfill is possible or honest: no payment before this migration
-- was ever recorded, and inventing settlements would be worse than having none.

CREATE TABLE doctor_payouts (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  doctor_id          BIGINT      NOT NULL REFERENCES doctors (id),
  location_id        BIGINT      NOT NULL REFERENCES locations (id),
  -- What was settled. A payout with no consultations is not a payout.
  consultation_count INTEGER     NOT NULL CHECK (consultation_count > 0),
  paid_paise         BIGINT      NOT NULL CHECK (paid_paise >= 0),
  -- The clinic day the settled work falls on, and the window wording as printed.
  covers_day         DATE        NOT NULL,
  covers_label       TEXT        NOT NULL,
  paid_by            UUID        NOT NULL REFERENCES users (id),
  paid_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Corrections are void + re-pay, never a delete or an edit (§6).
  voided_at          TIMESTAMPTZ,
  voided_by          UUID        REFERENCES users (id),
  void_reason        TEXT,
  CONSTRAINT doctor_payouts_void_shape
    CHECK ((voided_at IS NULL) = (voided_by IS NULL))
);

CREATE INDEX doctor_payouts_doctor_day_idx ON doctor_payouts (doctor_id, covers_day);
CREATE INDEX doctor_payouts_location_paid_idx ON doctor_payouts (location_id, paid_at);

CREATE TABLE doctor_payout_bills (
  payout_id BIGINT  NOT NULL REFERENCES doctor_payouts (id),
  bill_id   BIGINT  NOT NULL REFERENCES bills (id),
  -- FALSE once the payout is voided: the link stays as history, but the bill is
  -- released and can be settled again.
  active    BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (payout_id, bill_id)
);

-- THE constraint. One live payout per consultation bill - the structural reason the
-- same shift cannot be paid twice.
CREATE UNIQUE INDEX doctor_payout_bills_one_active
  ON doctor_payout_bills (bill_id) WHERE active;
