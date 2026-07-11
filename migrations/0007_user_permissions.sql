-- 0007_user_permissions.sql
--
-- Granular, admin-granted capabilities layered ON TOP of a user's role (plan 1B).
-- Roles stay coarse; a permission grants one specific extra capability (e.g.
-- "Can modify service lines") to a chosen non-admin so they can do procedure work
-- without being an admin.
--
--   * users.permissions - a TEXT[] of permission KEYS (validated on the server
--     against the typed registry in lib/permissions.ts; unknown keys are rejected
--     before they ever reach here). Default '{}' - no user starts with any grant.
--     `admin` implicitly has every permission, so admin rows keep '{}' and the
--     check short-circuits on role (no redundant grants stored).
--
-- Storage choice (plan B-1): a column, not a user_permissions join table. Simple
-- and adequate for a small staff; the normalized table is the alternative if this
-- ever needs per-grant metadata (who/when), which it doesn't at this scale.
--
-- Forward-only. Existing rows get the '{}' default.

ALTER TABLE users ADD COLUMN permissions TEXT[] NOT NULL DEFAULT '{}';
