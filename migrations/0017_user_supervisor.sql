-- 0017_user_supervisor.sql
--
-- A staff member can be assigned a SUPERVISOR - another user (a supervisor or an
-- admin) they report to. This is the relationship only; what a supervisor is
-- allowed to DO for their staff is a separate, later concern (no permissions are
-- attached to this link yet).
--
--   * users.supervisor_id - nullable self-reference to users(id). NULL means "no
--     supervisor assigned". ON DELETE is left as the default (RESTRICT); staff
--     accounts are deactivated, never hard-deleted, so a supervisor row never
--     actually disappears out from under an assignee.
--
-- The server validates that the assigned supervisor is an ACTIVE user whose role
-- is supervisor or admin, and that a user is never their own supervisor - the FK
-- only guarantees the id exists.
--
-- Forward-only. Existing rows get NULL (no supervisor).

ALTER TABLE users ADD COLUMN supervisor_id UUID REFERENCES users (id);

CREATE INDEX users_supervisor_idx ON users (supervisor_id);
