-- 0022_suggestions.sql
--
-- A tiny always-visible "Suggestions" box (any signed-in staff member, any
-- page) so counter staff can flag friction or ideas without leaving their
-- work - developers read the notes here later. Not a billing table, but it
-- still carries location_id per the app-wide convention (DEVELOPMENT_RULES
-- §4) and user_id, nullable in case a session can't be resolved.
--
-- No status/priority/assignee workflow: kept to what's needed today (§1.5) -
-- developers read the table (or /admin/suggestions) directly rather than
-- triaging in-app. Nothing is ever deleted here, so the note trail stays whole.
-- Forward-only.

CREATE TABLE suggestions (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  location_id BIGINT      NOT NULL REFERENCES locations(id),
  user_id     UUID        REFERENCES users(id),
  message     TEXT        NOT NULL,
  page_path   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX suggestions_created_at_idx ON suggestions (created_at DESC);
