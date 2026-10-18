-- migrate:up
CREATE TABLE monitor_headers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  monitor_id uuid NOT NULL REFERENCES monitors (id) ON DELETE CASCADE,
  name text NOT NULL CHECK (name ~ '^[!#$%&''*+.^_`|~0-9A-Za-z-]+$'),
  value_encrypted bytea NOT NULL,
  is_secret boolean NOT NULL DEFAULT true
);

-- HTTP header names are case-insensitive; this also indexes monitor lookups.
CREATE UNIQUE INDEX monitor_headers_monitor_name_idx
  ON monitor_headers (monitor_id, lower(name));

COMMENT ON COLUMN monitor_headers.value_encrypted IS
  'Versioned encrypted header value. Encryption keys are held outside the database.';

-- migrate:down
DROP TABLE monitor_headers;
