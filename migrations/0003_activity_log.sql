-- 0003_activity_log.sql - formalize audit_log as the app-wide activity log.
--
-- audit_log already exists (0001) and is the one canonical, append-only activity
-- trail (DEVELOPMENT_RULES §4/§8). This migration evolves it - it does NOT create
-- a second table (that would split the audit trail). Changes:
--   * add location_id (the "location_id on every core table" rule, §4);
--   * add a type-agnostic target_id TEXT that can hold a UUID (users) OR a bigint
--     (doctors, bills, …) - the old entity_id BIGINT could not hold a user UUID;
--   * backfill target_id from the prior convention (target id carried in details);
--   * drop entity_id (superseded by target_id);
--   * index action + location_id, and recreate the entity index (dropping
--     entity_id also drops the composite audit_log_entity_idx).
-- Forward-only. Only a handful of dev rows exist, so the backfill is trivial.

ALTER TABLE audit_log ADD COLUMN location_id BIGINT REFERENCES locations (id);
ALTER TABLE audit_log ADD COLUMN target_id   TEXT;  -- holds a UUID or a BIGINT id as text

-- Backfill target_id from the existing conventions: user actions stored the UUID
-- under details.user_id, doctor actions stored the id under details.doctor_id.
UPDATE audit_log
   SET target_id = COALESCE(details->>'user_id', details->>'doctor_id')
 WHERE target_id IS NULL;

-- entity_id (BIGINT) can't hold UUIDs and is superseded by target_id. Dropping it
-- also drops the composite index audit_log_entity_idx (entity, entity_id).
ALTER TABLE audit_log DROP COLUMN entity_id;

CREATE INDEX audit_log_action_idx   ON audit_log (action);
CREATE INDEX audit_log_location_idx ON audit_log (location_id);
CREATE INDEX audit_log_entity_idx   ON audit_log (entity);  -- recreated on entity alone
-- (existing, untouched: audit_log_at_idx, audit_log_user_idx)
