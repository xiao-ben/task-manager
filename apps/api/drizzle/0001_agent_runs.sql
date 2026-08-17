-- agent_runs：任务派发的 Cursor Agent 运行记录

CREATE TABLE IF NOT EXISTS agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL,
  agent_id text,
  run_id text,
  status text NOT NULL DEFAULT 'running',
  result text,
  transcript text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS agent_runs_task_idx ON agent_runs (task_id);
