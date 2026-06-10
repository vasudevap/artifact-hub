ALTER TABLE users
  ALTER COLUMN created_at SET DEFAULT NOW(),
  ALTER COLUMN updated_at SET DEFAULT NOW();

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS token_hash TEXT,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ALTER COLUMN created_at SET DEFAULT NOW();

UPDATE sessions
SET token_hash = token
WHERE token_hash IS NULL;

ALTER TABLE sessions
  ALTER COLUMN token_hash SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);

ALTER TABLE password_resets
  ALTER COLUMN created_at SET DEFAULT NOW();

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ALTER COLUMN status SET DEFAULT 'active',
  ALTER COLUMN created_at SET DEFAULT NOW(),
  ALTER COLUMN updated_at SET DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'projects_id_owner_id_key'
  ) THEN
    ALTER TABLE projects ADD CONSTRAINT projects_id_owner_id_key UNIQUE (id, owner_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS template_sources (
  id TEXT PRIMARY KEY,
  standard_key TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS artifact_templates (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL,
  lifecycle_stage TEXT NOT NULL,
  recommended BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'active',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS artifact_template_versions (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES artifact_templates(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  source_id TEXT REFERENCES template_sources(id),
  fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  recommendation_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_notes TEXT,
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deprecated_at TIMESTAMPTZ,
  UNIQUE (template_id, version_number)
);

INSERT INTO template_sources (id, standard_key, name, url, notes)
VALUES
  ('pmi', 'PMI', 'Project Management Institute practice guidance', 'https://www.pmi.org/standards/pmbok', 'PMI anchors project authorization, planning, governance, risk, and closure artifacts.'),
  ('iiba', 'IIBA', 'IIBA Business Analysis Standard', 'https://www.iiba.org/knowledgehub/business-analysis-standard/', 'IIBA anchors strategy analysis, elicitation, requirements analysis, and solution evaluation artifacts.'),
  ('togaf', 'TOGAF', 'The Open Group TOGAF Standard', 'https://www.opengroup.org/togaf', 'TOGAF anchors architecture vision, requirements, solution architecture, and transition planning artifacts.'),
  ('pmi-iiba', 'PMI / IIBA', 'PMI and IIBA cross-practice artifact guidance', NULL, 'This template draws from both project management and business analysis practice.'),
  ('togaf-pmi', 'TOGAF / PMI', 'TOGAF and PMI cross-practice artifact guidance', NULL, 'This template bridges architecture transition planning with delivery governance.'),
  ('artifacthub', 'ArtifactHub', 'ArtifactHub standardized template catalog', NULL, 'Fallback source for catalog-managed templates.')
ON CONFLICT (id) DO UPDATE
SET standard_key = EXCLUDED.standard_key,
    name = EXCLUDED.name,
    url = EXCLUDED.url,
    notes = EXCLUDED.notes;

INSERT INTO artifact_templates (
  id, title, description, category, lifecycle_stage, recommended, sort_order
)
VALUES
  ('business-case', 'Business Case', 'Justifies why the project should exist by defining the problem, value, options, costs, risks, and success measures.', 'Project Initiation', 'Pre-Initiation', FALSE, 10),
  ('project-charter', 'Project Charter', 'Defines the project purpose, measurable objectives, scope boundaries, stakeholders, risks, and success conditions.', 'Project Initiation', 'Initiation', TRUE, 20),
  ('stakeholder-register', 'Stakeholder Register and Engagement Plan', 'Identifies stakeholders, their interests, impacts, influence, and engagement approach.', 'Stakeholder Management', 'Initiation', FALSE, 30),
  ('integrated-project-plan', 'Integrated Project Plan', 'Provides the working plan for delivery approach, milestones, governance, controls, and execution rhythms.', 'Planning', 'Planning', FALSE, 40),
  ('scope-statement', 'Scope Statement and Deliverables Baseline', 'Defines detailed project and product scope, deliverables, acceptance criteria, assumptions, constraints, and exclusions.', 'Planning', 'Planning', FALSE, 50),
  ('requirements-package', 'Requirements Package / BRD', 'Captures business, stakeholder, functional, and non-functional requirements in a structured package.', 'Requirements', 'Planning', FALSE, 60),
  ('requirements-traceability', 'Requirements Traceability Matrix', 'Connects requirements to objectives, design, delivery, testing, decisions, and status.', 'Requirements', 'Control', FALSE, 70),
  ('raid-log', 'RAID Log', 'Tracks risks, assumptions, issues, and dependencies that require active monitoring and action.', 'Delivery and Tracking', 'Delivery', FALSE, 80),
  ('change-decision-log', 'Change and Decision Log', 'Maintains the record of changes, key decisions, rationale, impacts, and follow-through actions.', 'Governance', 'Governance', FALSE, 90),
  ('architecture-vision', 'Architecture Vision', 'Defines target architecture intent, stakeholder concerns, scope, principles, and high-level end state.', 'Architecture', 'Initiation', FALSE, 100),
  ('architecture-requirements', 'Architecture Requirements Specification', 'Consolidates architecture-significant requirements, constraints, assumptions, and quality attributes.', 'Architecture', 'Planning', FALSE, 110),
  ('solution-architecture', 'Solution Architecture Definition', 'Documents the end-to-end solution across business, application, data, integration, and technology viewpoints.', 'Architecture', 'Design', FALSE, 120),
  ('transition-migration-plan', 'Transition and Migration Plan', 'Defines implementation, release, adoption, and operational transition with manageable risk.', 'Delivery and Tracking', 'Delivery', FALSE, 130),
  ('test-acceptance-plan', 'Test and Acceptance Plan', 'Defines how requirements will be verified, outcomes validated, and stakeholder acceptance secured.', 'Validation', 'Validation', FALSE, 140),
  ('closure-lessons-learned', 'Closure Report and Lessons Learned', 'Summarizes delivery outcomes, acceptance, benefits outlook, unresolved items, and reusable lessons.', 'Closure', 'Closure', FALSE, 150),
  ('communications-plan', 'Communications Plan', 'Defines communication objectives, audiences, messages, channels, cadence, ownership, and escalation paths.', 'Stakeholder Management', 'Planning', TRUE, 160)
ON CONFLICT (id) DO UPDATE
SET title = EXCLUDED.title,
    description = EXCLUDED.description,
    category = EXCLUDED.category,
    lifecycle_stage = EXCLUDED.lifecycle_stage,
    recommended = EXCLUDED.recommended,
    sort_order = EXCLUDED.sort_order,
    updated_at = NOW();

INSERT INTO artifact_template_versions (
  id, template_id, version_number, source_id, fields, recommendation_metadata, source_notes
)
VALUES
  ('business-case:v1', 'business-case', 1, 'pmi-iiba', '[]'::jsonb, '{}'::jsonb, 'Business case and strategy analysis practices.'),
  ('project-charter:v1', 'project-charter', 1, 'pmi', '[]'::jsonb, '{}'::jsonb, 'Legacy Project Charter template retained for existing artifacts.'),
  ('project-charter:v2', 'project-charter', 2, 'pmi', '[]'::jsonb, '{"priority":1,"when":["new-project","charter-missing"]}'::jsonb, 'Current Project Charter template.'),
  ('stakeholder-register:v1', 'stakeholder-register', 1, 'pmi-iiba', '[]'::jsonb, '{}'::jsonb, 'Stakeholder identification and engagement planning.'),
  ('integrated-project-plan:v1', 'integrated-project-plan', 1, 'pmi', '[]'::jsonb, '{}'::jsonb, 'Integrated delivery planning.'),
  ('scope-statement:v1', 'scope-statement', 1, 'pmi-iiba', '[]'::jsonb, '{}'::jsonb, 'Scope statement and deliverables baseline.'),
  ('requirements-package:v1', 'requirements-package', 1, 'iiba', '[]'::jsonb, '{}'::jsonb, 'Requirements analysis and design definition.'),
  ('requirements-traceability:v1', 'requirements-traceability', 1, 'pmi-iiba', '[]'::jsonb, '{}'::jsonb, 'Requirements traceability across delivery lifecycle.'),
  ('raid-log:v1', 'raid-log', 1, 'pmi', '[]'::jsonb, '{}'::jsonb, 'Risk, assumption, issue, and dependency tracking.'),
  ('change-decision-log:v1', 'change-decision-log', 1, 'pmi', '[]'::jsonb, '{}'::jsonb, 'Change control and decision governance.'),
  ('architecture-vision:v1', 'architecture-vision', 1, 'togaf', '[]'::jsonb, '{}'::jsonb, 'Architecture Vision.'),
  ('architecture-requirements:v1', 'architecture-requirements', 1, 'togaf', '[]'::jsonb, '{}'::jsonb, 'Architecture Requirements Specification.'),
  ('solution-architecture:v1', 'solution-architecture', 1, 'togaf', '[]'::jsonb, '{}'::jsonb, 'Solution architecture definition.'),
  ('transition-migration-plan:v1', 'transition-migration-plan', 1, 'togaf-pmi', '[]'::jsonb, '{}'::jsonb, 'Transition and migration planning.'),
  ('test-acceptance-plan:v1', 'test-acceptance-plan', 1, 'pmi-iiba', '[]'::jsonb, '{}'::jsonb, 'Validation and acceptance planning.'),
  ('closure-lessons-learned:v1', 'closure-lessons-learned', 1, 'pmi', '[]'::jsonb, '{}'::jsonb, 'Project closure and lessons learned.'),
  ('communications-plan:v1', 'communications-plan', 1, 'pmi', '[]'::jsonb, '{"priority":4,"when":["stakeholder-complexity","charter-approved"]}'::jsonb, 'Communications management planning.')
ON CONFLICT (id) DO UPDATE
SET source_id = EXCLUDED.source_id,
    recommendation_metadata = EXCLUDED.recommendation_metadata,
    source_notes = EXCLUDED.source_notes;

INSERT INTO artifact_templates (
  id, title, description, category, lifecycle_stage, status
)
SELECT DISTINCT
  a.template_id,
  a.template_id,
  '',
  'Legacy',
  'Delivery',
  'active'
FROM artifacts a
WHERE NOT EXISTS (
  SELECT 1 FROM artifact_templates t WHERE t.id = a.template_id
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO artifact_template_versions (
  id, template_id, version_number, fields, recommendation_metadata, source_notes
)
SELECT DISTINCT
  a.template_id || ':v' || COALESCE(a.template_version, 1)::text,
  a.template_id,
  COALESCE(a.template_version, 1),
  '[]'::jsonb,
  '{}'::jsonb,
  'Legacy template version inferred from existing artifact rows.'
FROM artifacts a
ON CONFLICT (id) DO NOTHING;

ALTER TABLE artifacts
  ADD COLUMN IF NOT EXISTS template_version_id TEXT,
  ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ALTER COLUMN status SET DEFAULT 'draft',
  ALTER COLUMN field_values SET DEFAULT '{}'::jsonb,
  ALTER COLUMN workflow_stage SET DEFAULT 'drafting',
  ALTER COLUMN revision SET DEFAULT 1,
  ALTER COLUMN template_version SET DEFAULT 1,
  ALTER COLUMN created_at SET DEFAULT NOW(),
  ALTER COLUMN updated_at SET DEFAULT NOW();

UPDATE artifacts
SET template_version_id = template_id || ':v' || COALESCE(template_version, 1)::text
WHERE template_version_id IS NULL;

UPDATE artifacts
SET assigned_at = COALESCE(assigned_at, created_at)
WHERE project_id IS NOT NULL;

ALTER TABLE artifacts
  ALTER COLUMN template_version_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'artifacts_template_version_id_fkey'
  ) THEN
    ALTER TABLE artifacts
      ADD CONSTRAINT artifacts_template_version_id_fkey
      FOREIGN KEY (template_version_id)
      REFERENCES artifact_template_versions(id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'artifacts_project_owner_id_fkey'
  ) THEN
    ALTER TABLE artifacts
      ADD CONSTRAINT artifacts_project_owner_id_fkey
      FOREIGN KEY (project_id, owner_id)
      REFERENCES projects(id, owner_id)
      ON DELETE CASCADE;
  END IF;
END $$;

ALTER TABLE project_context_items
  ALTER COLUMN value SET DEFAULT 'null'::jsonb,
  ALTER COLUMN trust_state SET DEFAULT 'proposed',
  ALTER COLUMN source_type SET DEFAULT 'user',
  ALTER COLUMN created_at SET DEFAULT NOW(),
  ALTER COLUMN updated_at SET DEFAULT NOW();

ALTER TABLE artifact_field_provenance
  ALTER COLUMN updated_at SET DEFAULT NOW();

ALTER TABLE artifact_review_findings
  ALTER COLUMN status SET DEFAULT 'open',
  ALTER COLUMN created_at SET DEFAULT NOW();

ALTER TABLE artifact_versions
  ALTER COLUMN approved_at SET DEFAULT NOW();

ALTER TABLE artifact_exports
  ALTER COLUMN created_at SET DEFAULT NOW();

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS owner_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS context_scope TEXT NOT NULL DEFAULT 'artifact_only',
  ALTER COLUMN project_id DROP NOT NULL,
  ALTER COLUMN operation SET DEFAULT 'interview',
  ALTER COLUMN status SET DEFAULT 'active',
  ALTER COLUMN created_at SET DEFAULT NOW(),
  ALTER COLUMN updated_at SET DEFAULT NOW();

UPDATE conversations c
SET owner_id = p.owner_id,
    context_scope = 'project_context'
FROM projects p
WHERE c.project_id = p.id
  AND c.owner_id IS NULL;

ALTER TABLE conversations
  ALTER COLUMN owner_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'conversations_project_owner_id_fkey'
  ) THEN
    ALTER TABLE conversations
      ADD CONSTRAINT conversations_project_owner_id_fkey
      FOREIGN KEY (project_id, owner_id)
      REFERENCES projects(id, owner_id)
      ON DELETE CASCADE;
  END IF;
END $$;

ALTER TABLE ai_runs
  ADD COLUMN IF NOT EXISTS owner_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  ALTER COLUMN prompt_version SET DEFAULT 1,
  ALTER COLUMN template_version SET DEFAULT 1,
  ALTER COLUMN created_at SET DEFAULT NOW();

UPDATE ai_runs r
SET owner_id = a.owner_id
FROM artifacts a
WHERE r.artifact_id = a.id
  AND r.owner_id IS NULL;

ALTER TABLE ai_runs
  ALTER COLUMN owner_id SET NOT NULL,
  ALTER COLUMN conversation_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS activity_events (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT,
  artifact_id TEXT REFERENCES artifacts(id) ON DELETE SET NULL,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (project_id, owner_id) REFERENCES projects(id, owner_id) ON DELETE CASCADE
);

INSERT INTO activity_events (
  id, owner_id, project_id, artifact_id, actor_id, event_type, summary,
  metadata, created_at
)
SELECT
  e.id,
  p.owner_id,
  e.project_id,
  a.id,
  e.actor_id,
  e.event_type,
  e.summary,
  e.metadata,
  e.created_at
FROM project_activity_events e
INNER JOIN projects p ON p.id = e.project_id
LEFT JOIN artifacts a ON a.id = e.metadata->>'artifactId'
ON CONFLICT (id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_projects_owner_id ON projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_owner_id ON artifacts(owner_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_project_id ON artifacts(project_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_owner_unassigned_updated
  ON artifacts(owner_id, updated_at DESC)
  WHERE project_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_context_project_id ON project_context_items(project_id);
CREATE INDEX IF NOT EXISTS idx_findings_artifact_id ON artifact_review_findings(artifact_id);
CREATE INDEX IF NOT EXISTS idx_versions_artifact_id ON artifact_versions(artifact_id);
CREATE INDEX IF NOT EXISTS idx_activity_owner_created
  ON activity_events(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_project_created
  ON activity_events(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_owner_artifact
  ON conversations(owner_id, artifact_id);
CREATE INDEX IF NOT EXISTS idx_ai_runs_owner_artifact
  ON ai_runs(owner_id, artifact_id);
