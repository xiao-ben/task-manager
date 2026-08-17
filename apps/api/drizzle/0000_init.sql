-- Manual bootstrap for Neon / Postgres when not using drizzle-kit push

CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  notes text,
  status text NOT NULL DEFAULT 'todo',
  day text NOT NULL,
  repo_path text,
  cursor_agent_id text,
  cursor_session_id text,
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS repos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  path text NOT NULL,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS summaries (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  period_type text NOT NULL,
  period_key text NOT NULL,
  content text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (period_type, period_key)
);

CREATE INDEX IF NOT EXISTS tasks_day_idx ON tasks (day);
CREATE INDEX IF NOT EXISTS tasks_session_idx ON tasks (cursor_session_id);
