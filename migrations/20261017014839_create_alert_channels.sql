-- migrate:up
CREATE TABLE alert_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'email' CHECK (type = 'email'),
  target text NOT NULL CHECK (length(trim(target)) > 0)
);

CREATE INDEX alert_channels_user_id_idx ON alert_channels (user_id);

-- migrate:down
DROP TABLE alert_channels;
