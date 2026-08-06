-- 0028_consultation_revisit_series.sql - let a revisit be CHARGED without losing
-- the date its taper is measured from.
--
-- Migration 0027 gave each doctor reduced rates for the days after the free
-- window. Collecting one of those rates means taking money, and taking money at
-- this counter means a bill: a DB-issued number, a payment mode, a frozen doctor
-- share, a printable receipt, a void/re-issue path. The free-revisit path has
-- none of that - it deliberately writes only a visit row.
--
-- WHY A NEW CONSULTATION ROW RATHER THAN A SECOND BILL ON THE OLD ONE. Every
-- consultation in this system has at most one consultation-type bill, and a great
-- deal leans on that: listConsultations LEFT JOINs it one-to-one (a second bill
-- would duplicate every history row), the void/re-issue chain is per bill, and
-- the doctor payout links bills. Hanging a second bill off one consultation would
-- break all three at once. A paid revisit is therefore its OWN consultation row,
-- priced at the reduced rate, linked back to the one it continues.
--
-- WHAT THAT WOULD BREAK, AND WHAT STOPS IT. A new row would ordinarily restart
-- the clock, and a patient could ride ₹400 revisits forever. So the taper is not
-- measured from the row - it is measured from `series_started_on`, the day the
-- FIRST consultation of this run took place, which a paid revisit copies forward
-- unchanged. `valid_until` is copied forward too: the free window was already
-- spent, and re-granting it would hand out free visits the hospital never priced.
-- Only a visit past the last reduced rate starts a genuinely new series, with
-- today as its anchor and a fresh window.
--
-- `revisit_of_consultation_id` is the audit trail - the row this one continues -
-- and is NULL for the first consultation of a series. Deliberately not the
-- anchor: reading a date should never mean walking a chain.
--
-- Backfill: every existing consultation is the first of its own series, so its
-- anchor is its own creation day in clinic time (Asia/Kolkata, the zone every
-- other date in this schema is read in) and its link is NULL. Clamped with LEAST
-- because seeded and back-dated rows exist whose valid_until predates their
-- created_at; for those the window is the only date that was ever meaningful, and
-- an anchor after it would describe a run that ended before it began.

ALTER TABLE consultations
  ADD COLUMN series_started_on DATE,
  ADD COLUMN revisit_of_consultation_id BIGINT REFERENCES consultations (id);

UPDATE consultations
   SET series_started_on = LEAST((created_at AT TIME ZONE 'Asia/Kolkata')::date, valid_until)
 WHERE series_started_on IS NULL;

ALTER TABLE consultations ALTER COLUMN series_started_on SET NOT NULL;

-- The anchor can never sit after the window it opened, in any row.
ALTER TABLE consultations
  ADD CONSTRAINT consultations_series_before_valid_until
  CHECK (series_started_on <= valid_until);

CREATE INDEX consultations_revisit_of_idx
  ON consultations (revisit_of_consultation_id)
  WHERE revisit_of_consultation_id IS NOT NULL;
