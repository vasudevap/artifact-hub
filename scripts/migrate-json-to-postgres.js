import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import { initDatabase, pool, USE_DATABASE } from "../storage.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, "..");

async function readJson(relativePath, fallback) {
  try {
    const content = await fs.readFile(path.join(projectRoot, relativePath), "utf-8");
    return content.trim() ? JSON.parse(content) : fallback;
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function templateVersionIdFor(templateId, templateVersion = 1) {
  return `${templateId}:v${Number(templateVersion) || 1}`;
}

async function ensureTemplateVersion(client, artifact) {
  const templateId = artifact.templateId;
  const templateVersion = Number(artifact.templateVersion) || 1;

  await client.query(
    `INSERT INTO artifact_templates (
       id, title, description, category, lifecycle_stage, status
     )
     VALUES ($1, $2, '', 'Legacy', 'Delivery', 'active')
     ON CONFLICT (id) DO NOTHING`,
    [templateId, artifact.title || templateId],
  );
  await client.query(
    `INSERT INTO artifact_template_versions (
       id, template_id, version_number, fields, recommendation_metadata, source_notes
     )
     VALUES ($1, $2, $3, '[]'::jsonb, '{}'::jsonb, 'Inferred from migrated JSON artifact data.')
     ON CONFLICT (id) DO NOTHING`,
    [templateVersionIdFor(templateId, templateVersion), templateId, templateVersion],
  );
}

async function migrate() {
  if (!USE_DATABASE) {
    throw new Error("DATABASE_URL is required to run the migration.");
  }

  await initDatabase();

  const [users, sessions, projects, unassignedArtifacts] = await Promise.all([
    readJson("data/users.json", []),
    readJson("data/sessions.json", []),
    readJson("data/projects.json", []),
    readJson("data/artifacts.json", []),
  ]);

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    for (const user of users) {
      await client.query(
        `INSERT INTO users (id, name, email, password_hash, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE
         SET name = EXCLUDED.name,
             email = EXCLUDED.email,
             password_hash = EXCLUDED.password_hash,
             created_at = EXCLUDED.created_at,
             updated_at = EXCLUDED.updated_at`,
        [
          user.id,
          user.name,
          user.email,
          user.passwordHash,
          user.createdAt,
          user.updatedAt,
        ],
      );
    }

    for (const session of sessions) {
      await client.query(
        `INSERT INTO sessions (id, user_id, token, token_hash, created_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE
         SET user_id = EXCLUDED.user_id,
             token = EXCLUDED.token,
             token_hash = EXCLUDED.token_hash,
             created_at = EXCLUDED.created_at`,
        [
          session.id,
          session.userId,
          session.token,
          session.tokenHash || hashToken(session.token),
          session.createdAt,
        ],
      );
    }

    for (const project of projects) {
      await client.query(
        `INSERT INTO projects (id, owner_id, name, sponsor, objective, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE
         SET owner_id = EXCLUDED.owner_id,
             name = EXCLUDED.name,
             sponsor = EXCLUDED.sponsor,
             objective = EXCLUDED.objective,
             status = EXCLUDED.status,
             created_at = EXCLUDED.created_at,
             updated_at = EXCLUDED.updated_at`,
        [
          project.id,
          project.ownerId,
          project.name,
          project.sponsor,
          project.objective,
          project.status,
          project.createdAt,
          project.updatedAt,
        ],
      );

      for (const artifact of project.artifacts || []) {
        await ensureTemplateVersion(client, artifact);
        await client.query(
          `INSERT INTO artifacts (
             id, owner_id, project_id, template_version_id, template_id, title,
             status, field_values, revision, template_version, workflow_stage,
             assigned_at, created_at, updated_at
           )
           VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13, $14
           )
           ON CONFLICT (id) DO UPDATE
           SET owner_id = EXCLUDED.owner_id,
               project_id = EXCLUDED.project_id,
               template_version_id = EXCLUDED.template_version_id,
               template_id = EXCLUDED.template_id,
               title = EXCLUDED.title,
               status = EXCLUDED.status,
               field_values = EXCLUDED.field_values,
               revision = EXCLUDED.revision,
               template_version = EXCLUDED.template_version,
               workflow_stage = EXCLUDED.workflow_stage,
               assigned_at = EXCLUDED.assigned_at,
               created_at = EXCLUDED.created_at,
               updated_at = EXCLUDED.updated_at`,
          [
            artifact.id,
            project.ownerId,
            project.id,
            templateVersionIdFor(artifact.templateId, artifact.templateVersion),
            artifact.templateId,
            artifact.title,
            artifact.status,
            JSON.stringify(artifact.fieldValues || {}),
            Number(artifact.revision) || 1,
            Number(artifact.templateVersion) || 1,
            artifact.workflowStage || "drafting",
            artifact.assignedAt || artifact.createdAt,
            artifact.createdAt,
            artifact.updatedAt,
          ],
        );
      }
    }

    for (const artifact of unassignedArtifacts) {
      await ensureTemplateVersion(client, artifact);
      await client.query(
        `INSERT INTO artifacts (
           id, owner_id, project_id, template_version_id, template_id, title,
           status, field_values, revision, template_version, workflow_stage,
           assigned_at, created_at, updated_at
         )
         VALUES (
           $1, $2, NULL, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, NULL, $11, $12
         )
         ON CONFLICT (id) DO UPDATE
         SET owner_id = EXCLUDED.owner_id,
             project_id = NULL,
             template_version_id = EXCLUDED.template_version_id,
             template_id = EXCLUDED.template_id,
             title = EXCLUDED.title,
             status = EXCLUDED.status,
             field_values = EXCLUDED.field_values,
             revision = EXCLUDED.revision,
             template_version = EXCLUDED.template_version,
             workflow_stage = EXCLUDED.workflow_stage,
             assigned_at = NULL,
             created_at = EXCLUDED.created_at,
             updated_at = EXCLUDED.updated_at`,
        [
          artifact.id,
          artifact.ownerId,
          templateVersionIdFor(artifact.templateId, artifact.templateVersion),
          artifact.templateId,
          artifact.title,
          artifact.status,
          JSON.stringify(artifact.fieldValues || {}),
          Number(artifact.revision) || 1,
          Number(artifact.templateVersion) || 1,
          artifact.workflowStage || "drafting",
          artifact.createdAt,
          artifact.updatedAt,
        ],
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate()
  .then(() => {
    console.log("JSON data migrated to PostgreSQL.");
  })
  .catch((error) => {
    console.error("Migration failed.", error);
    process.exit(1);
  });
