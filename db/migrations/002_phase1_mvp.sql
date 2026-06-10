ALTER TABLE artifacts
  ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS template_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS workflow_stage TEXT NOT NULL DEFAULT 'drafting';

CREATE TABLE IF NOT EXISTS project_context_items (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  item_key TEXT NOT NULL,
  label TEXT NOT NULL,
  value JSONB NOT NULL DEFAULT 'null'::jsonb,
  trust_state TEXT NOT NULL DEFAULT 'proposed',
  source_type TEXT NOT NULL DEFAULT 'user',
  source_record_id TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE(project_id, category, item_key)
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  operation TEXT NOT NULL DEFAULT 'interview',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS conversation_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_runs (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  operation TEXT NOT NULL,
  prompt_version INTEGER NOT NULL DEFAULT 1,
  template_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL,
  structured_result JSONB,
  usage JSONB,
  latency_ms INTEGER,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE(artifact_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS artifact_field_provenance (
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  field_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_record_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(artifact_id, field_id)
);

CREATE TABLE IF NOT EXISTS artifact_review_findings (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  field_id TEXT,
  source_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  finding_type TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS artifact_versions (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  snapshot JSONB NOT NULL,
  approved_by TEXT NOT NULL REFERENCES users(id),
  approved_at TIMESTAMPTZ NOT NULL,
  UNIQUE(artifact_id, version_number)
);

CREATE TABLE IF NOT EXISTS artifact_exports (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  artifact_version_id TEXT REFERENCES artifact_versions(id),
  format TEXT NOT NULL,
  requested_by TEXT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS project_activity_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL REFERENCES users(id),
  event_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_context_project_id ON project_context_items(project_id);
CREATE INDEX IF NOT EXISTS idx_conversations_artifact_id ON conversations(artifact_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON conversation_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_ai_runs_artifact_id ON ai_runs(artifact_id);
CREATE INDEX IF NOT EXISTS idx_findings_artifact_id ON artifact_review_findings(artifact_id);
CREATE INDEX IF NOT EXISTS idx_versions_artifact_id ON artifact_versions(artifact_id);
CREATE INDEX IF NOT EXISTS idx_activity_project_id ON project_activity_events(project_id);
