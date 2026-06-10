ALTER TABLE artifact_templates
  ADD COLUMN IF NOT EXISTS stage_key TEXT,
  ADD COLUMN IF NOT EXISTS stage_name TEXT,
  ADD COLUMN IF NOT EXISTS stage_order INTEGER,
  ADD COLUMN IF NOT EXISTS stage_use_when TEXT;

UPDATE artifact_templates
SET stage_key = stage.stage_key,
    stage_name = stage.stage_name,
    stage_order = stage.stage_order,
    stage_use_when = stage.stage_use_when
FROM (
  VALUES
    ('business-case', 'define', 'Define', 1, 'Justify the work and shape the initial project idea before authorization.'),
    ('project-charter', 'authorize', 'Authorize', 2, 'Formally start the project and identify who matters.'),
    ('stakeholder-register', 'authorize', 'Authorize', 2, 'Formally start the project and identify who matters.'),
    ('architecture-vision', 'authorize', 'Authorize', 2, 'Formally start the project and identify who matters.'),
    ('integrated-project-plan', 'plan', 'Plan', 3, 'Establish scope, delivery approach, requirements, governance, and communications.'),
    ('scope-statement', 'plan', 'Plan', 3, 'Establish scope, delivery approach, requirements, governance, and communications.'),
    ('requirements-package', 'plan', 'Plan', 3, 'Establish scope, delivery approach, requirements, governance, and communications.'),
    ('communications-plan', 'plan', 'Plan', 3, 'Establish scope, delivery approach, requirements, governance, and communications.'),
    ('architecture-requirements', 'design', 'Design', 4, 'Translate requirements and architecture concerns into solution direction.'),
    ('solution-architecture', 'design', 'Design', 4, 'Translate requirements and architecture concerns into solution direction.'),
    ('requirements-traceability', 'design', 'Design', 4, 'Translate requirements and architecture concerns into solution direction.'),
    ('raid-log', 'execute-control', 'Execute And Control', 5, 'Manage delivery movement, risks, decisions, changes, dependencies, and traceability.'),
    ('change-decision-log', 'execute-control', 'Execute And Control', 5, 'Manage delivery movement, risks, decisions, changes, dependencies, and traceability.'),
    ('test-acceptance-plan', 'validate-transition', 'Validate And Transition', 6, 'Prove readiness, acceptance, rollout, and operational transition.'),
    ('transition-migration-plan', 'validate-transition', 'Validate And Transition', 6, 'Prove readiness, acceptance, rollout, and operational transition.'),
    ('closure-lessons-learned', 'close', 'Close', 7, 'Finish formally and preserve reusable learning.')
) AS stage(template_id, stage_key, stage_name, stage_order, stage_use_when)
WHERE artifact_templates.id = stage.template_id;

UPDATE artifact_templates
SET stage_key = COALESCE(stage_key, 'plan'),
    stage_name = COALESCE(stage_name, 'Plan'),
    stage_order = COALESCE(stage_order, 3),
    stage_use_when = COALESCE(
      stage_use_when,
      'Establish scope, delivery approach, requirements, governance, and communications.'
    );

ALTER TABLE artifact_templates
  ALTER COLUMN stage_key SET NOT NULL,
  ALTER COLUMN stage_name SET NOT NULL,
  ALTER COLUMN stage_order SET NOT NULL,
  ALTER COLUMN stage_use_when SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_artifact_templates_stage_order
  ON artifact_templates(stage_order, sort_order);
