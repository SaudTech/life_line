-- 0018_ip_bill_settlement.sql - persist the discharge SETTLEMENT on the IP bill, so
-- reporting can tell what was BILLED apart from what was COLLECTED.
--
-- The bug this fixes. calculateDischargeBalance (lib/billing/discharge.ts) returns
-- six figures, and the IP discharge only ever persisted three of them
-- (subtotal/discount/total). `total_paise` is (room + expenses) − discount: it is the
-- GROSS bill, and it still INCLUDES the money already taken as an advance at admit.
-- The two figures that say what actually changed hands at the counter -
-- balanceDuePaise and refundPaise - were dropped into an audit_log JSON blob and
-- nowhere else.
--
-- So every "money in" query had no column to read and instead summed
--   bills.total_paise  +  admissions.advance_paid_paise
-- which counts the advance TWICE (once at admit, once inside the discharge total).
-- Advance ₹10,000 + discharge total ₹15,000 = ₹15,000 collected, reported as ₹25,000.
-- And a refund (advance > total) moved cash OUT of the drawer with no column, no
-- query and no screen able to see it.
--
--   * bills.balance_due_paise - what the patient paid AT DISCHARGE (total − advance).
--   * bills.refund_paise      - what was handed BACK at discharge (advance − total).
--
-- These mirror DischargeBalance.balanceDuePaise / .refundPaise one-for-one, so the
-- bill row is now a faithful record of the pure rule's output. Exactly one of the two
-- is ever non-zero (both are 0 when the advance settles the total exactly).
--
-- Non-IP bills keep both at 0: an OP bill is settled in full when it is issued, so
-- nothing is due afterwards and nothing is refunded. Their money-in stays total_paise.
-- See lib/money-in.ts - the ONE place that expression is written.
--
-- Backfill is derivable, not fabricated: every IP bill links to its admission
-- (bills.admission_id, 0012) which holds the advance, so the settlement is recomputed
-- with the same GREATEST(0, …) clamp the pure rule uses. Forward-only.

ALTER TABLE bills
  ADD COLUMN balance_due_paise BIGINT NOT NULL DEFAULT 0 CHECK (balance_due_paise >= 0),
  ADD COLUMN refund_paise      BIGINT NOT NULL DEFAULT 0 CHECK (refund_paise >= 0);

UPDATE bills b
   SET balance_due_paise = GREATEST(0, b.total_paise - a.advance_paid_paise),
       refund_paise      = GREATEST(0, a.advance_paid_paise - b.total_paise)
  FROM admissions a
 WHERE b.admission_id = a.id
   AND b.type = 'ip';
