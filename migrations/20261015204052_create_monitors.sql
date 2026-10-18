-- migrate:up
CREATE TABLE monitors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  url text NOT NULL CHECK (url ~ '^https?://'),
  method text NOT NULL DEFAULT 'GET' CHECK (method IN ('GET', 'HEAD')),
  interval_seconds integer NOT NULL DEFAULT 60 CHECK (interval_seconds >= 30),
  timeout_ms integer NOT NULL DEFAULT 10000 CHECK (timeout_ms BETWEEN 1 AND 30000),
  expected_status integer NOT NULL DEFAULT 200 CHECK (expected_status BETWEEN 100 AND 599),
  paused boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'unknown' CHECK (status IN ('unknown', 'up', 'down')),
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  next_run_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz
);

CREATE INDEX monitors_user_id_idx ON monitors (user_id);
CREATE INDEX monitors_next_run_at_idx ON monitors (next_run_at) WHERE NOT paused;

-- migrate:down
DROP TABLE monitors;
