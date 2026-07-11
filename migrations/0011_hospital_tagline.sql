-- 0011_hospital_tagline.sql - a tagline line for the receipt letterhead.
--
-- The A4 receipt header shows the hospital name, then a small tagline
-- ("A MULTI SPECIALITY HOSPITAL"), then address + phone. name/address/phone
-- already live on hospital_profile (0010); tagline is the one missing piece.
-- Optional (nullable) - a location without one simply omits the line.
--
-- Forward-only.

ALTER TABLE hospital_profile ADD COLUMN tagline TEXT;
