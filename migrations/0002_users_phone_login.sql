-- 0002_users_phone_login.sql - staff sign in with their phone number.
--
-- Removes the separate `login` (username) field: a user is now identified at
-- sign-in by their phone. Phone therefore becomes UNIQUE and required on the
-- users table.
--
-- IMPORTANT: this uniqueness is on the USERS (staff) table only. patients.phone
-- stays NON-UNIQUE by design - a mother and child can share one number
-- (PROJECT_OVERVIEW §3). Staff each have their own phone, so unique is correct
-- here and does not touch the patient rule.

-- Accounts created before phone-login have no phone. In Phase 1 the only such row
-- is the first-run admin, and no bills reference users yet, so drop phone-less
-- users; first-run recreates the admin from FIRST_RUN_ADMIN_PHONE /
-- FIRST_RUN_ADMIN_PASSWORD on the next server start.
DELETE FROM users WHERE phone IS NULL;

-- Dropping the column also drops its UNIQUE constraint (users_login_unique).
ALTER TABLE users DROP COLUMN login;

ALTER TABLE users ALTER COLUMN phone SET NOT NULL;
ALTER TABLE users ADD CONSTRAINT users_phone_unique UNIQUE (phone);
