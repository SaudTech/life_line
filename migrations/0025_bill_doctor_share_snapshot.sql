-- 0025_bill_doctor_share_snapshot.sql - FREEZE the doctor's cut onto the bill.
--
-- The bug this fixes. Until now the doctor's share was never stored: every screen
-- recomputed it at READ time from `doctors.share_type/share_percentage/
-- share_flat_paise` (lib/doctors/share.ts's doctorShareSql, now deleted). That was
-- deliberate and harmless while the figure was INFORMATIONAL - the cut sits in the
-- drawer and is settled with the doctor later, so "what is owed at today's rate" is
-- the honest answer for an unpaid obligation.
--
-- It stops being harmless the moment cash is handed across the counter against that
-- number. Dr Khalid is on 40% and is paid ₹5,200 for his 12:00-14:00 shift. At 18:00
-- his rate is raised to 50%. Reprint the morning slip: it now reads ₹6,500. Nothing
-- anywhere records that ₹5,200 was the agreed figure or that it was paid, so
-- "we underpaid him" and "the rate changed afterwards" become indistinguishable -
-- and the doctor's printed copy disagrees with the system that printed it.
--
-- A payment is a RECORD, not a view. Records do not recompute. So the share is now
-- computed ONCE, when the consultation bill is written (which is also when it is
-- finalized and when the discount is known - see createConsultationWithBill: the
-- consultation, its first visit and its bill are one transaction), and stored:
--
--   * bills.doctor_share_paise       - the frozen amount, integer paise (§1).
--   * bills.doctor_share_type        - 'percentage' | 'flat', the rate's FORM…
--   * bills.doctor_share_percentage  - …and its value, whichever column applies.
--   * bills.doctor_share_flat_paise
--
-- The rate columns ride along so a payout slip can say HOW the amount was arrived at
-- ("40% of ₹13,000") from the row itself, without joining `doctors` and thereby
-- reading today's rate onto yesterday's paper - the exact bug above.
--
-- `doctor_share_paise` is NOT NULL DEFAULT 0 because zero is the truthful answer for
-- every bill that owes no doctor anything: a procedure bill, an IP discharge, a
-- consultation for a doctor configured at 0%. The three rate columns stay NULL on
-- those rows - there was no rate, and 0% is a different statement from "no rate".
--
-- BACKFILL. Existing consultation bills are priced at each doctor's CURRENT rate.
-- That is not a guess: it is exactly the number every screen reports for those bills
-- today, so applying this migration changes no figure anywhere. It is the only
-- defensible value - the historical rate was never recorded, which is the whole
-- point of this migration. From here forward, history is fixed.
--
-- The expression below mirrors doctorSharePaise() in lib/doctors/share.ts one for
-- one (LEAST(...) is its clamp - a flat ₹500 share on a ₹300 discounted consultation
-- is ₹300, never more, so the hospital's remainder can never go negative). It is
-- written out here rather than shared from TypeScript BECAUSE it must never run
-- again: a live-pricing SQL expression kept around is precisely the footgun being
-- removed. Forward-only.

ALTER TABLE bills
  ADD COLUMN doctor_share_paise      BIGINT NOT NULL DEFAULT 0
    CHECK (doctor_share_paise >= 0),
  ADD COLUMN doctor_share_type       TEXT
    CHECK (doctor_share_type IS NULL OR doctor_share_type IN ('percentage', 'flat')),
  ADD COLUMN doctor_share_percentage INTEGER
    CHECK (doctor_share_percentage IS NULL OR doctor_share_percentage BETWEEN 0 AND 100),
  ADD COLUMN doctor_share_flat_paise BIGINT
    CHECK (doctor_share_flat_paise IS NULL OR doctor_share_flat_paise >= 0),
  -- A recorded rate is complete or absent, never half-written: if we say the form
  -- was 'percentage', the percentage must be there to reprint the slip with.
  ADD CONSTRAINT bills_doctor_share_shape CHECK (
    doctor_share_type IS NULL
    OR (doctor_share_type = 'percentage' AND doctor_share_percentage IS NOT NULL)
    OR (doctor_share_type = 'flat'       AND doctor_share_flat_paise IS NOT NULL)
  );

UPDATE bills b
   SET doctor_share_paise = LEAST(
         CASE WHEN d.share_type = 'flat'
              THEN COALESCE(d.share_flat_paise, 0)
              ELSE round(b.total_paise * d.share_percentage / 100.0)::bigint
         END,
         b.total_paise),
       doctor_share_type       = d.share_type,
       doctor_share_percentage = CASE WHEN d.share_type = 'percentage'
                                      THEN d.share_percentage END,
       doctor_share_flat_paise = CASE WHEN d.share_type = 'flat'
                                      THEN COALESCE(d.share_flat_paise, 0) END
  FROM consultations c, doctors d
 WHERE b.consultation_id = c.id
   AND c.doctor_id = d.id
   AND b.type = 'consultation';

-- The doctor-earnings report groups by doctor over a time window at one location,
-- so the join lands on consultations by (doctor_id, id) and the id is needed to
-- meet bills.consultation_id. consultations_doctor_idx (0001) is doctor_id alone;
-- this covers the lookup without a heap visit for the join key.
CREATE INDEX consultations_doctor_id_idx ON consultations (doctor_id, id);
