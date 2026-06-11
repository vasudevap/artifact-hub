CREATE TABLE IF NOT EXISTS system_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value JSONB NOT NULL DEFAULT 'null'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY,
  event_name TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  session_id TEXT,
  request_path TEXT,
  project_id TEXT,
  artifact_id TEXT REFERENCES artifacts(id) ON DELETE SET NULL,
  template_id TEXT,
  event_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_audit_events (
  id TEXT PRIMARY KEY,
  admin_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  target_type TEXT,
  target_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usage_events_occurred_at
  ON usage_events(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_events_user_id
  ON usage_events(user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_events_event_name
  ON usage_events(event_name, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_events_created_at
  ON admin_audit_events(created_at DESC);
