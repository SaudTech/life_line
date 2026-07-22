-- 0019_dashboard_indexes.sql - index the columns the admin dashboard and the daily
-- report actually filter on.
--
-- admissions was indexed for the counter (patient_id, status, created_by) but NOT for
-- reporting: there was no index on location_id and none on admitted_at - the exact two
-- columns every dashboard query filters. Every one of them was a guaranteed seq scan,
-- 6× per admin page load.
--
-- bills had five SINGLE-column indexes (created_at, patient_id, created_by, status,
-- location_id) and no composite covering the real access pattern, which is always
-- "this location + final + this clinic-day range". A lone bills_status_idx on a
-- 3-value column is near-useless on its own.
--
-- Column order is (equality, equality, range) so the range scan starts at the right
-- leaf: location_id and status are matched exactly, created_at/admitted_at is the
-- half-open clinic-day window (lib/money-in.ts clinicRange). This shape is what makes
-- the range predicate index-friendly - the reason clinicRange never wraps the filtered
-- column in a per-row function.
--
-- ~174k bills today growing ~50k/year: this is the difference between the dashboard
-- staying instant and degrading a little every month until someone notices. Verify
-- with EXPLAIN ANALYZE against a realistic dataset (npm run seed:bulk) - on an empty
-- dev DB a seq scan is always fast and this work looks pointless.
--
-- The old single-column bills_location_idx / bills_created_at_idx are left in place:
-- other screens (patient history, reprint search) filter on them alone.

CREATE INDEX admissions_location_admitted_idx ON admissions (location_id, admitted_at);

CREATE INDEX bills_location_status_created_idx ON bills (location_id, status, created_at);
