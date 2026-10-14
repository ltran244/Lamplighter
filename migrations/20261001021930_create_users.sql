-- migrate:up
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  github_id bigint NOT NULL UNIQUE,
  username text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- migrate:down
DROP TABLE users;
