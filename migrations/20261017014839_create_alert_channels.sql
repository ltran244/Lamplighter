-- migrate:up
CREATE TABLE alert_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'discord' CHECK (type = 'discord'),
  target_url text NOT NULL CHECK (target_url LIKE 'https://discord.com/api/webhooks/%')
);

CREATE INDEX alert_channels_user_id_idx ON alert_channels (user_id);

-- migrate:down
DROP TABLE alert_channels;
