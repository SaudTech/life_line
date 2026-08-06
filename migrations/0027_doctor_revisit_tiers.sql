-- 0027_doctor_revisit_tiers.sql - tapered revisit pricing for a doctor.
--
-- Until now a revisit was a boolean: same doctor, on or before valid_until → free;
-- one day later → a brand new consultation at the full fee. Real practice is a
-- taper. A doctor charging ₹1,000 may see the patient free for 7 days, ₹400 up to
-- day 9, ₹700 up to day 12, and only then charge afresh. The cliff is what the
-- hospital wants to remove, not the rule.
--
-- WHY A TABLE AND NOT MORE COLUMNS. "free_days + discount_days + discount_price"
-- looks cheaper and is a trap: it fixes the number of bands at two, and it cannot
-- express a gap. The example above already has one - if day 8 is ₹400 and "day 10
-- to 12" is ₹700, nobody has said what day 9 costs. A row per band, keyed by the
-- day it runs THROUGH, makes every day resolvable by construction: the band is the
-- first one whose through_day >= the days elapsed. A gap is unrepresentable, and a
-- fourth band later is an INSERT rather than a migration.
--
-- WHAT LIVES HERE AND WHAT DOES NOT. Only the PRICED bands. The free window stays
-- on doctors.revisit_validity_days, which is what consultations.valid_until is
-- already computed from - duplicating it here would give one rule two sources of
-- truth (DEVELOPMENT_RULES §1). So every through_day in this table must be greater
-- than that doctor's revisit_validity_days, and the days above the last band are
-- the full fee again. That ordering is enforced in lib/doctors/revisit-tiers.ts,
-- which both the form and the server action validate against - a CHECK here cannot
-- see the parent row's column, and a trigger would put a billing rule in the DB
-- where no test can reach it.
--
-- price_paise is integer minor units (§1), like fee_paise. The primary key is the
-- natural one: a doctor cannot have two bands ending on the same day. Rows are
-- rewritten wholesale when a doctor is saved, so no surrogate id is needed. No
-- location_id: this is a detail of the doctors row, which carries its own (same
-- reasoning as doctor_payout_bills in 0026), and ON DELETE CASCADE keeps it that
-- way if a doctor row is ever removed.
--
-- Nothing to backfill. Every existing doctor keeps exactly today's behaviour: a
-- free window and then the full fee, which is this table with no rows.

CREATE TABLE doctor_revisit_tiers (
  doctor_id   BIGINT  NOT NULL REFERENCES doctors (id) ON DELETE CASCADE,
  -- The last day (counted from the first consultation) this band covers.
  through_day INTEGER NOT NULL CHECK (through_day >= 0 AND through_day <= 3650),
  -- What a revisit inside this band costs. A band is never free - the free window
  -- is doctors.revisit_validity_days - and never reaches the full fee, or it would
  -- be indistinguishable from a new consultation.
  price_paise BIGINT  NOT NULL CHECK (price_paise > 0),
  PRIMARY KEY (doctor_id, through_day)
);
