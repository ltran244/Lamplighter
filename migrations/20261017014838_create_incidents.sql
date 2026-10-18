-- migrate:up
CREATE TABLE incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  monitor_id uuid NOT NULL REFERENCES monitors (id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  cause text NOT NULL,
  CONSTRAINT incidents_resolved_at_check CHECK (resolved_at >= started_at)
);

CREATE INDEX incidents_monitor_started_at_idx ON incidents (monitor_id, started_at DESC);
CREATE UNIQUE INDEX incidents_one_open_per_monitor_idx
  ON incidents (monitor_id) WHERE resolved_at IS NULL;

-- migrate:down
DROP TABLE incidents;
