-- 0013_ip_room_days.sql - model the room charge as a per-day rate × number of days.
--
-- The room charge is really "rate per day × days" (a week-long stay is ₹800/day ×
-- 7). We keep admissions.room_charge_paise as the authoritative TOTAL (so all
-- discharge math and receipts are unchanged), and add the two components so the
-- breakdown can be shown on screen and reprinted on the invoice, and so the desk
-- gets a dedicated per-day input instead of typing a lump figure.
--
-- Both nullable: an admission may have no room set yet (deferred to discharge), or
-- an older row that only ever had a flat total. Forward-only.

ALTER TABLE admissions
  ADD COLUMN room_rate_paise BIGINT CHECK (room_rate_paise IS NULL OR room_rate_paise >= 0),
  ADD COLUMN room_days       INTEGER CHECK (room_days IS NULL OR room_days >= 1);
