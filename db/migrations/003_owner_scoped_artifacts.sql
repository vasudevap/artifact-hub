ALTER TABLE artifacts
  ADD COLUMN IF NOT EXISTS owner_id TEXT REFERENCES users(id) ON DELETE CASCADE;

UPDATE artifacts a
SET owner_id = p.owner_id
FROM projects p
WHERE a.project_id = p.id
  AND a.owner_id IS NULL;

ALTER TABLE artifacts
  ALTER COLUMN owner_id SET NOT NULL,
  ALTER COLUMN project_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_artifacts_owner_id ON artifacts(owner_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_unassigned_owner_id
  ON artifacts(owner_id)
  WHERE project_id IS NULL;
