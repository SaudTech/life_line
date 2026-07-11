-- 0012_ip_admission_bill_link.sql - link the discharge bill back to its admission,
-- and record how the admission advance was paid.
--
-- 1. bills.admission_id - the final in-patient bill (bills.type = 'ip') must point
--    at the admission it settles, mirroring how consultation_id was added in 0006
--    for consultation bills. Nullable: OP bills (consultation / procedure) have no
--    admission.
--
-- 2. admissions.advance_payment_mode - how the advance was tendered at admission
--    (cash/card/upi/other). Nullable (older rows, or an advance of 0). Persisted so
--    the A4 advance-deposit receipt is reproducible on reprint from the DB alone
--    (plan §5b) - never recomputed or guessed.
--
-- Forward-only.

ALTER TABLE bills ADD COLUMN admission_id BIGINT REFERENCES admissions (id);

CREATE INDEX bills_admission_idx ON bills (admission_id);

ALTER TABLE admissions
  ADD COLUMN advance_payment_mode TEXT
    CHECK (advance_payment_mode IN ('cash', 'card', 'upi', 'other'));
