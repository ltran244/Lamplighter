-- migrate:up
CREATE TABLE check_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  monitor_id uuid NOT NULL REFERENCES monitors (id) ON DELETE CASCADE,
  scheduled_at timestamptz NOT NULL,
  actual_start timestamptz NOT NULL,
  finished_at timestamptz NOT NULL,
  status_code integer CHECK (status_code BETWEEN 100 AND 599),
  latency_ms integer NOT NULL CHECK (latency_ms >= 0),
  ok boolean NOT NULL,
  error text,
  worker_id text NOT NULL,
  CONSTRAINT check_runs_finished_at_check CHECK (finished_at >= actual_start),
  CONSTRAINT check_runs_monitor_scheduled_at_key UNIQUE (monitor_id, scheduled_at)
);

-- The unique index also supports per-monitor history and uptime queries.

-- migrate:down
DROP TABLE check_runs;
