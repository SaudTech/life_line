-- 0009_service_trash.sql
--
-- Split a service's two independent axes (they were conflated on deactivated_at):
--
--   * services.active         - the BILLABLE toggle. Active = sold at the counter;
--                               Inactive = retired but KEPT indefinitely (hidden
--                               from the Part 2 procedure picker, shown in the
--                               catalog). Already exists (0001); no change here.
--   * services.trashed_at      - the TRASH marker (was deactivated_at). NULL = not
--                               trashed. When set, the service is in Trash and is
--                               permanently purged after SERVICE_RETENTION_DAYS.
--                               Independent of `active` - trashing does not flip
--                               the billable flag, and restoring keeps it as it was.
--
-- Just a rename: the column's data (any in-flight trash timestamps) carries over.
-- Forward-only.

ALTER TABLE services RENAME COLUMN deactivated_at TO trashed_at;
