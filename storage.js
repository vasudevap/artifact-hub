import path from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";
import crypto from "crypto";
import pg from "pg";
import { runMigrations } from "./migrations.js";

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");
const PROJECTS_FILE = path.join(DATA_DIR, "projects.json");
const ARTIFACTS_FILE = path.join(DATA_DIR, "artifacts.json");
const PASSWORD_RESETS_FILE = path.join(DATA_DIR, "password-resets.json");
const PHASE1_FILE = path.join(DATA_DIR, "phase1.json");

const DATABASE_URL = process.env.DATABASE_URL;
const USE_DATABASE = Boolean(DATABASE_URL);

const pool = USE_DATABASE
  ? new Pool({
      connectionString: DATABASE_URL,
      max: Number(process.env.DATABASE_POOL_MAX) || 5,
      ssl:
        process.env.NODE_ENV === "production"
          ? { rejectUnauthorized: false }
          : false,
    })
  : null;

async function readJsonFile(filePath, fallback) {
  try {
    const data = await fs.readFile(filePath, "utf-8");
    return data.trim() ? JSON.parse(data) : fallback;
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

async function writeJsonFile(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

function mapArtifact(row) {
  return {
    id: row.id,
    ownerId: row.owner_id ?? row.ownerId ?? null,
    projectId: row.project_id ?? row.projectId ?? null,
    projectName: row.project_name ?? row.projectName ?? null,
    templateVersionId: row.template_version_id ?? row.templateVersionId ?? null,
    templateId: row.template_id ?? row.templateId,
    title: row.title,
    status: row.status,
    fieldValues: row.field_values ?? row.fieldValues ?? {},
    revision: Number(row.revision) || 1,
    templateVersion: Number(row.template_version ?? row.templateVersion) || 1,
    workflowStage: row.workflow_stage ?? row.workflowStage ?? "drafting",
    createdAt: row.created_at ?? row.createdAt,
    updatedAt: row.updated_at ?? row.updatedAt,
  };
}

function mapProject(row, artifacts = []) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    sponsor: row.sponsor,
    objective: row.objective,
    status: row.status,
    artifacts,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeLocalArtifact(artifact, project) {
  return {
    ...artifact,
    ownerId: artifact.ownerId || project?.ownerId || null,
    projectId: artifact.projectId ?? project?.id ?? null,
    projectName: artifact.projectName ?? project?.name ?? null,
    revision: Number(artifact.revision) || 1,
    templateVersion: Number(artifact.templateVersion) || 1,
    workflowStage: artifact.workflowStage || "drafting",
  };
}

function normalizeLocalProject(project) {
  if (!project) {
    return null;
  }

  return {
    ...project,
    artifacts: (project.artifacts || []).map((artifact) =>
      normalizeLocalArtifact(artifact, project),
    ),
  };
}

function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function templateVersionIdFor(templateId, templateVersion = 1) {
  return `${templateId}:v${Number(templateVersion) || 1}`;
}

function nowIso() {
  return new Date().toISOString();
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function initDatabase() {
  if (!USE_DATABASE) {
    return;
  }

  await runMigrations(pool);
}

async function getStorageHealth() {
  if (!USE_DATABASE) {
    return {
      type: "json",
      mode: "local-fallback",
      ok: true,
      migrations: null,
    };
  }

  await pool.query("SELECT 1");
  const migrationResult = await pool.query(
    `SELECT version, name, applied_at
     FROM schema_migrations
     ORDER BY version DESC
     LIMIT 1`,
  );
  const latestMigration = migrationResult.rows[0] || null;
  const migrationCountResult = await pool.query(
    "SELECT COUNT(*)::int AS applied_count FROM schema_migrations",
  );

  return {
    type: "postgres",
    mode: "primary",
    ok: true,
    migrations: {
      appliedCount: Number(migrationCountResult.rows[0]?.applied_count) || 0,
      latestVersion: latestMigration ? Number(latestMigration.version) : null,
      latestName: latestMigration?.name || null,
      latestAppliedAt: latestMigration?.applied_at || null,
    },
  };
}

async function listProjectsByOwnerId(ownerId) {
  if (!USE_DATABASE) {
    const projects = await readJsonFile(PROJECTS_FILE, []);
    return projects
      .filter((project) => project.ownerId === ownerId)
      .map(normalizeLocalProject);
  }

  const projectResult = await pool.query(
    `SELECT *
     FROM projects
     WHERE owner_id = $1
     ORDER BY created_at DESC`,
    [ownerId],
  );

  const artifactResult = await pool.query(
    `SELECT a.*
     FROM artifacts a
     INNER JOIN projects p ON p.id = a.project_id
     WHERE p.owner_id = $1
     ORDER BY a.created_at DESC`,
    [ownerId],
  );

  const artifactsByProjectId = new Map();

  for (const row of artifactResult.rows) {
    const artifacts = artifactsByProjectId.get(row.project_id) || [];
    artifacts.push(mapArtifact(row));
    artifactsByProjectId.set(row.project_id, artifacts);
  }

  return projectResult.rows.map((row) =>
    mapProject(row, artifactsByProjectId.get(row.id) || []),
  );
}

async function getProjectByIdAndOwnerId(projectId, ownerId) {
  if (!USE_DATABASE) {
    const projects = await readJsonFile(PROJECTS_FILE, []);
    return normalizeLocalProject(
      projects.find(
        (project) => project.id === projectId && project.ownerId === ownerId,
      ) || null,
    );
  }

  const projectResult = await pool.query(
    `SELECT *
     FROM projects
     WHERE id = $1 AND owner_id = $2`,
    [projectId, ownerId],
  );

  const row = projectResult.rows[0];

  if (!row) {
    return null;
  }

  const artifactResult = await pool.query(
    `SELECT *
     FROM artifacts
     WHERE project_id = $1
     ORDER BY created_at DESC`,
    [projectId],
  );

  return mapProject(
    row,
    artifactResult.rows.map((artifactRow) => mapArtifact(artifactRow)),
  );
}

async function listUnassignedArtifactsByOwnerId(ownerId) {
  if (!USE_DATABASE) {
    const artifacts = await readJsonFile(ARTIFACTS_FILE, []);
    return artifacts
      .filter((artifact) => artifact.ownerId === ownerId && !artifact.projectId)
      .map((artifact) => normalizeLocalArtifact(artifact))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  const result = await pool.query(
    `SELECT a.*, p.name AS project_name
     FROM artifacts a
     LEFT JOIN projects p ON p.id = a.project_id
     WHERE a.owner_id = $1
       AND a.project_id IS NULL
       AND a.archived_at IS NULL
     ORDER BY a.updated_at DESC`,
    [ownerId],
  );

  return result.rows.map(mapArtifact);
}

async function createProject({ ownerId, name, sponsor, objective }) {
  const timestamp = nowIso();
  const project = {
    id: createId("project"),
    ownerId,
    name,
    sponsor,
    objective,
    status: "active",
    artifacts: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  if (!USE_DATABASE) {
    const projects = await readJsonFile(PROJECTS_FILE, []);
    projects.unshift(project);
    await writeJsonFile(PROJECTS_FILE, projects);
    return project;
  }

  await pool.query(
    `INSERT INTO projects (id, owner_id, name, sponsor, objective, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
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

  return project;
}

async function deleteProjectByIdAndOwnerId(projectId, ownerId) {
  if (!USE_DATABASE) {
    const projects = await readJsonFile(PROJECTS_FILE, []);
    const project = projects.find(
      (item) => item.id === projectId && item.ownerId === ownerId,
    );

    if (!project) {
      return false;
    }

    const remainingProjects = projects.filter((item) => item.id !== projectId);
    await writeJsonFile(PROJECTS_FILE, remainingProjects);
    return true;
  }

  const result = await pool.query(
    `DELETE FROM projects
     WHERE id = $1 AND owner_id = $2`,
    [projectId, ownerId],
  );

  return result.rowCount > 0;
}

async function createArtifact({
  projectId,
  ownerId,
  templateId,
  title,
  fieldValues,
  templateVersion = 1,
}) {
  const timestamp = nowIso();
  const artifact = {
    id: createId("artifact"),
    ownerId,
    projectId: projectId || null,
    projectName: null,
    templateVersionId: templateVersionIdFor(templateId, templateVersion),
    templateId,
    title,
    status: "draft",
    fieldValues,
    revision: 1,
    templateVersion,
    workflowStage: "drafting",
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  if (!USE_DATABASE) {
    if (!projectId) {
      const artifacts = await readJsonFile(ARTIFACTS_FILE, []);
      artifacts.unshift(artifact);
      await writeJsonFile(ARTIFACTS_FILE, artifacts);
      return artifact;
    }

    const projects = await readJsonFile(PROJECTS_FILE, []);
    const project = projects.find(
      (item) => item.id === projectId && item.ownerId === ownerId,
    );
    if (!project) {
      return null;
    }

    artifact.projectName = project.name;
    project.artifacts.unshift(artifact);
    project.updatedAt = timestamp;
    await writeJsonFile(PROJECTS_FILE, projects);
    return artifact;
  }

  let projectName = null;

  if (projectId) {
    const ownership = await pool.query(
      `SELECT id, name
       FROM projects
       WHERE id = $1 AND owner_id = $2`,
      [projectId, ownerId],
    );

    if (!ownership.rows[0]) {
      return null;
    }
    projectName = ownership.rows[0].name;
    artifact.projectName = projectName;
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO artifacts (
         id, owner_id, project_id, template_version_id, template_id, title,
         status, field_values, revision, template_version, workflow_stage,
         assigned_at, created_at, updated_at
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13, $14
       )`,
      [
        artifact.id,
        ownerId,
        projectId || null,
        artifact.templateVersionId,
        artifact.templateId,
        artifact.title,
        artifact.status,
        JSON.stringify(artifact.fieldValues),
        artifact.revision,
        artifact.templateVersion,
        artifact.workflowStage,
        projectId ? timestamp : null,
        artifact.createdAt,
        artifact.updatedAt,
      ],
    );
    if (projectId) {
      await client.query(
        `UPDATE projects
         SET updated_at = $2
         WHERE id = $1`,
        [projectId, timestamp],
      );
    }
    await client.query("COMMIT");
    return { ...artifact, projectName };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getArtifactByIdAndOwnerId(artifactId, ownerId) {
  if (!USE_DATABASE) {
    const [projects, artifacts] = await Promise.all([
      readJsonFile(PROJECTS_FILE, []),
      readJsonFile(ARTIFACTS_FILE, []),
    ]);
    const unassigned = artifacts.find(
      (artifact) => artifact.id === artifactId && artifact.ownerId === ownerId,
    );
    if (unassigned) return normalizeLocalArtifact(unassigned);

    for (const project of projects.filter((item) => item.ownerId === ownerId)) {
      const artifact = (project.artifacts || []).find(
        (item) => item.id === artifactId,
      );
      if (artifact) return normalizeLocalArtifact(artifact, project);
    }
    return null;
  }

  const result = await pool.query(
    `SELECT a.*, p.name AS project_name
     FROM artifacts a
     LEFT JOIN projects p ON p.id = a.project_id
     WHERE a.id = $1 AND a.owner_id = $2`,
    [artifactId, ownerId],
  );

  return result.rows[0] ? mapArtifact(result.rows[0]) : null;
}

async function updateOwnedArtifact({
  artifactId,
  ownerId,
  title,
  status,
  fieldValues,
  expectedRevision,
  workflowStage,
}) {
  if (!USE_DATABASE) {
    const [projects, artifacts] = await Promise.all([
      readJsonFile(PROJECTS_FILE, []),
      readJsonFile(ARTIFACTS_FILE, []),
    ]);
    let targetArtifact = artifacts.find(
      (item) => item.id === artifactId && item.ownerId === ownerId,
    );
    let targetProject = null;
    let unassigned = Boolean(targetArtifact);

    if (!targetArtifact) {
      for (const project of projects.filter((item) => item.ownerId === ownerId)) {
        const artifact = (project.artifacts || []).find(
          (item) => item.id === artifactId,
        );
        if (artifact) {
          targetArtifact = artifact;
          targetProject = project;
          unassigned = false;
          break;
        }
      }
    }

    if (!targetArtifact) return { artifact: null };

    const currentRevision = Number(targetArtifact.revision) || 1;
    if (
      expectedRevision !== undefined &&
      Number(expectedRevision) !== currentRevision
    ) {
      return {
        artifact: null,
        stale: true,
        latestArtifact: normalizeLocalArtifact(targetArtifact, targetProject),
      };
    }

    const timestamp = nowIso();
    targetArtifact.title = title;
    targetArtifact.status = status;
    targetArtifact.fieldValues = fieldValues;
    targetArtifact.revision = currentRevision + 1;
    targetArtifact.templateVersion = Number(targetArtifact.templateVersion) || 1;
    targetArtifact.workflowStage =
      workflowStage || targetArtifact.workflowStage || "drafting";
    targetArtifact.updatedAt = timestamp;
    if (targetProject) targetProject.updatedAt = timestamp;

    await Promise.all([
      unassigned ? writeJsonFile(ARTIFACTS_FILE, artifacts) : Promise.resolve(),
      targetProject ? writeJsonFile(PROJECTS_FILE, projects) : Promise.resolve(),
    ]);

    return {
      artifact: normalizeLocalArtifact(targetArtifact, targetProject),
    };
  }

  const timestamp = nowIso();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE artifacts
       SET title = $3,
           status = $4,
           field_values = $5::jsonb,
           workflow_stage = COALESCE($6, workflow_stage),
           revision = revision + 1,
           updated_at = $7
       WHERE id = $1
         AND owner_id = $2
         AND ($8::integer IS NULL OR revision = $8)
       RETURNING *`,
      [
        artifactId,
        ownerId,
        title,
        status,
        JSON.stringify(fieldValues),
        workflowStage || null,
        timestamp,
        expectedRevision === undefined ? null : Number(expectedRevision),
      ],
    );

    if (!result.rows[0]) {
      const latestResult = await client.query(
        `SELECT a.*, p.name AS project_name
         FROM artifacts a
         LEFT JOIN projects p ON p.id = a.project_id
         WHERE a.id = $1 AND a.owner_id = $2`,
        [artifactId, ownerId],
      );
      await client.query("ROLLBACK");
      return latestResult.rows[0]
        ? {
            artifact: null,
            stale: true,
            latestArtifact: mapArtifact(latestResult.rows[0]),
          }
        : { artifact: null };
    }

    if (result.rows[0].project_id) {
      await client.query(
        `UPDATE projects
         SET updated_at = $2
         WHERE id = $1`,
        [result.rows[0].project_id, timestamp],
      );
    }

    await client.query("COMMIT");
    return { artifact: mapArtifact(result.rows[0]) };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function assignArtifactToProject({ artifactId, projectId, ownerId }) {
  if (!USE_DATABASE) {
    const [projects, artifacts] = await Promise.all([
      readJsonFile(PROJECTS_FILE, []),
      readJsonFile(ARTIFACTS_FILE, []),
    ]);
    const project = projects.find(
      (item) => item.id === projectId && item.ownerId === ownerId,
    );
    if (!project) {
      return { projectFound: false, artifactFound: false, artifact: null };
    }

    const artifactIndex = artifacts.findIndex(
      (item) => item.id === artifactId && item.ownerId === ownerId,
    );
    if (artifactIndex < 0) {
      const assignedProject = projects.find(
        (item) =>
          item.ownerId === ownerId &&
          (item.artifacts || []).some((artifact) => artifact.id === artifactId),
      );
      const assignedArtifact = assignedProject?.artifacts.find(
        (artifact) => artifact.id === artifactId,
      );
      return assignedArtifact
        ? {
            projectFound: true,
            artifactFound: true,
            alreadyAssigned: true,
            artifact: normalizeLocalArtifact(assignedArtifact, assignedProject),
            project: assignedProject,
          }
        : { projectFound: true, artifactFound: false, artifact: null };
    }

    const timestamp = nowIso();
    const [artifact] = artifacts.splice(artifactIndex, 1);
    artifact.projectId = project.id;
    artifact.projectName = project.name;
    artifact.revision = (Number(artifact.revision) || 1) + 1;
    artifact.updatedAt = timestamp;
    project.artifacts = project.artifacts || [];
    project.artifacts.unshift(artifact);
    project.updatedAt = timestamp;
    await Promise.all([
      writeJsonFile(ARTIFACTS_FILE, artifacts),
      writeJsonFile(PROJECTS_FILE, projects),
    ]);
    return {
      projectFound: true,
      artifactFound: true,
      artifact: normalizeLocalArtifact(artifact, project),
      project,
    };
  }

  const client = await pool.connect();
  const timestamp = nowIso();

  try {
    await client.query("BEGIN");
    const projectResult = await client.query(
      `SELECT *
       FROM projects
       WHERE id = $1 AND owner_id = $2`,
      [projectId, ownerId],
    );
    const project = projectResult.rows[0];
    if (!project) {
      await client.query("ROLLBACK");
      return { projectFound: false, artifactFound: false, artifact: null };
    }

    const result = await client.query(
      `UPDATE artifacts
       SET project_id = $3,
           assigned_at = COALESCE(assigned_at, $4),
           revision = revision + 1,
           updated_at = $4
       WHERE id = $1
         AND owner_id = $2
         AND project_id IS NULL
       RETURNING *`,
      [artifactId, ownerId, projectId, timestamp],
    );

    if (!result.rows[0]) {
      const existing = await client.query(
        `SELECT a.*, p.name AS project_name
         FROM artifacts a
         LEFT JOIN projects p ON p.id = a.project_id
         WHERE a.id = $1 AND a.owner_id = $2`,
        [artifactId, ownerId],
      );
      await client.query("ROLLBACK");
      return existing.rows[0]
        ? {
            projectFound: true,
            artifactFound: true,
            alreadyAssigned: Boolean(existing.rows[0].project_id),
            artifact: mapArtifact(existing.rows[0]),
          }
        : { projectFound: true, artifactFound: false, artifact: null };
    }

    await client.query(
      `UPDATE projects
       SET updated_at = $2
       WHERE id = $1`,
      [projectId, timestamp],
    );
    await client.query("COMMIT");

    return {
      projectFound: true,
      artifactFound: true,
      artifact: mapArtifact({
        ...result.rows[0],
        project_name: project.name,
      }),
      project: mapProject(project, []),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function updateArtifact({
  projectId,
  artifactId,
  ownerId,
  title,
  status,
  fieldValues,
  expectedRevision,
  workflowStage,
}) {
  if (!USE_DATABASE) {
    const projects = await readJsonFile(PROJECTS_FILE, []);
    const project = projects.find(
      (item) => item.id === projectId && item.ownerId === ownerId,
    );

    if (!project) {
      return { projectFound: false, artifact: null };
    }

    const artifact = project.artifacts.find((item) => item.id === artifactId);

    if (!artifact) {
      return { projectFound: true, artifact: null };
    }

    const currentRevision = Number(artifact.revision) || 1;

    if (
      expectedRevision !== undefined &&
      Number(expectedRevision) !== currentRevision
    ) {
      return {
        projectFound: true,
        artifact: null,
        stale: true,
        latestArtifact: {
          ...artifact,
          revision: currentRevision,
          templateVersion: Number(artifact.templateVersion) || 1,
          workflowStage: artifact.workflowStage || "drafting",
        },
      };
    }

    artifact.title = title;
    artifact.status = status;
    artifact.fieldValues = fieldValues;
    artifact.revision = currentRevision + 1;
    artifact.templateVersion = Number(artifact.templateVersion) || 1;
    artifact.workflowStage = workflowStage || artifact.workflowStage || "drafting";
    artifact.updatedAt = nowIso();
    project.updatedAt = artifact.updatedAt;
    await writeJsonFile(PROJECTS_FILE, projects);
    return { projectFound: true, artifact };
  }

  const projectResult = await pool.query(
    `SELECT id
     FROM projects
     WHERE id = $1 AND owner_id = $2`,
    [projectId, ownerId],
  );

  if (!projectResult.rows[0]) {
    return { projectFound: false, artifact: null };
  }

  const timestamp = nowIso();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE artifacts
       SET title = $3,
           status = $4,
           field_values = $5::jsonb,
           workflow_stage = COALESCE($6, workflow_stage),
           revision = revision + 1,
           updated_at = $7
       WHERE id = $1
         AND project_id = $2
         AND ($8::integer IS NULL OR revision = $8)
       RETURNING *`,
      [
        artifactId,
        projectId,
        title,
        status,
        JSON.stringify(fieldValues),
        workflowStage || null,
        timestamp,
        expectedRevision === undefined ? null : Number(expectedRevision),
      ],
    );

    if (!result.rows[0]) {
      const latestResult = await client.query(
        `SELECT *
         FROM artifacts
         WHERE id = $1 AND project_id = $2`,
        [artifactId, projectId],
      );
      await client.query("ROLLBACK");
      return latestResult.rows[0]
        ? {
            projectFound: true,
            artifact: null,
            stale: true,
            latestArtifact: mapArtifact(latestResult.rows[0]),
          }
        : { projectFound: true, artifact: null };
    }

    await client.query(
      `UPDATE projects
       SET updated_at = $2
       WHERE id = $1`,
      [projectId, timestamp],
    );
    await client.query("COMMIT");

    return { projectFound: true, artifact: mapArtifact(result.rows[0]) };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function deleteArtifact({ projectId, artifactId, ownerId }) {
  if (!USE_DATABASE) {
    const projects = await readJsonFile(PROJECTS_FILE, []);
    const project = projects.find(
      (item) => item.id === projectId && item.ownerId === ownerId,
    );

    if (!project) {
      return { projectFound: false, deleted: false, project: null };
    }

    const artifactExists = project.artifacts.some((item) => item.id === artifactId);

    if (!artifactExists) {
      return { projectFound: true, deleted: false, project: null };
    }

    project.artifacts = project.artifacts.filter((item) => item.id !== artifactId);
    project.updatedAt = nowIso();
    await writeJsonFile(PROJECTS_FILE, projects);
    return { projectFound: true, deleted: true, project };
  }

  const project = await getProjectByIdAndOwnerId(projectId, ownerId);

  if (!project) {
    return { projectFound: false, deleted: false, project: null };
  }

  const client = await pool.connect();
  const timestamp = nowIso();

  try {
    await client.query("BEGIN");
    const result = await client.query(
      `DELETE FROM artifacts
       WHERE id = $1 AND project_id = $2`,
      [artifactId, projectId],
    );

    if (!result.rowCount) {
      await client.query("ROLLBACK");
      return { projectFound: true, deleted: false, project: null };
    }

    await client.query(
      `UPDATE projects
       SET updated_at = $2
       WHERE id = $1`,
      [projectId, timestamp],
    );
    await client.query("COMMIT");

    const updatedProject = await getProjectByIdAndOwnerId(projectId, ownerId);
    return { projectFound: true, deleted: true, project: updatedProject };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getUserByEmail(email) {
  if (!USE_DATABASE) {
    const users = await readJsonFile(USERS_FILE, []);
    return users.find((user) => user.email === email) || null;
  }

  const result = await pool.query(
    `SELECT
       id,
       name,
       email,
       password_hash AS "passwordHash",
       created_at AS "createdAt",
       updated_at AS "updatedAt"
     FROM users
     WHERE email = $1`,
    [email],
  );

  return result.rows[0] || null;
}

async function getUserById(userId) {
  if (!USE_DATABASE) {
    const users = await readJsonFile(USERS_FILE, []);
    return users.find((user) => user.id === userId) || null;
  }

  const result = await pool.query(
    `SELECT
       id,
       name,
       email,
       password_hash AS "passwordHash",
       created_at AS "createdAt",
       updated_at AS "updatedAt"
     FROM users
     WHERE id = $1`,
    [userId],
  );

  return result.rows[0] || null;
}

async function getUserBySessionToken(token) {
  const tokenHash = hashToken(token);

  if (!USE_DATABASE) {
    const [sessions, users] = await Promise.all([
      readJsonFile(SESSIONS_FILE, []),
      readJsonFile(USERS_FILE, []),
    ]);
    const session = sessions.find((item) => item.token === token);

    if (!session) {
      return null;
    }

    return users.find((user) => user.id === session.userId) || null;
  }

  const result = await pool.query(
    `SELECT
       u.id,
       u.name,
       u.email,
       u.password_hash AS "passwordHash",
       u.created_at AS "createdAt",
       u.updated_at AS "updatedAt"
     FROM sessions s
     INNER JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1
        OR s.token = $2`,
    [tokenHash, token],
  );

  return result.rows[0] || null;
}

async function listUsersForAdmin() {
  if (!USE_DATABASE) {
    const [users, projects, unassignedArtifacts, sessions] = await Promise.all([
      readJsonFile(USERS_FILE, []),
      readJsonFile(PROJECTS_FILE, []),
      readJsonFile(ARTIFACTS_FILE, []),
      readJsonFile(SESSIONS_FILE, []),
    ]);

    return users
      .map((user) => {
        const ownedProjects = projects.filter((project) => project.ownerId === user.id);
        const ownedUnassigned = unassignedArtifacts.filter(
          (artifact) => artifact.ownerId === user.id,
        );
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
          projectCount: ownedProjects.length,
          sessionCount: sessions.filter((session) => session.userId === user.id).length,
          artifactCount:
            ownedUnassigned.length +
            ownedProjects.reduce(
              (count, project) => count + project.artifacts.length,
              0,
            ),
        };
      })
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  const result = await pool.query(
    `SELECT
       u.id,
       u.name,
       u.email,
       u.created_at AS "createdAt",
       u.updated_at AS "updatedAt",
       COUNT(DISTINCT p.id)::int AS "projectCount",
       COUNT(DISTINCT a.id)::int AS "artifactCount",
       COUNT(DISTINCT s.id)::int AS "sessionCount"
     FROM users u
     LEFT JOIN projects p ON p.owner_id = u.id
     LEFT JOIN artifacts a ON a.owner_id = u.id
     LEFT JOIN sessions s ON s.user_id = u.id
     GROUP BY u.id
     ORDER BY u.created_at DESC`,
  );

  return result.rows;
}

async function createUser({ name, email, passwordHash }) {
  const timestamp = nowIso();
  const user = {
    id: createId("user"),
    name,
    email,
    passwordHash,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  if (!USE_DATABASE) {
    const users = await readJsonFile(USERS_FILE, []);
    users.push(user);
    await writeJsonFile(USERS_FILE, users);
    return user;
  }

  await pool.query(
    `INSERT INTO users (id, name, email, password_hash, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      user.id,
      user.name,
      user.email,
      user.passwordHash,
      user.createdAt,
      user.updatedAt,
    ],
  );

  return user;
}

async function createSession({ userId, token }) {
  const session = {
    id: createId("session"),
    userId,
    token,
    tokenHash: hashToken(token),
    createdAt: nowIso(),
  };

  if (!USE_DATABASE) {
    const sessions = await readJsonFile(SESSIONS_FILE, []);
    sessions.push(session);
    await writeJsonFile(SESSIONS_FILE, sessions);
    return session;
  }

  await pool.query(
    `INSERT INTO sessions (id, user_id, token, token_hash, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      session.id,
      session.userId,
      session.token,
      session.tokenHash,
      session.createdAt,
    ],
  );

  return session;
}

async function createPasswordReset({ email, expiresAt }) {
  const user = await getUserByEmail(email);

  if (!user) {
    return null;
  }

  const reset = {
    id: createId("reset"),
    userId: user.id,
    token: crypto.randomBytes(32).toString("hex"),
    expiresAt,
    usedAt: null,
    createdAt: nowIso(),
  };
  const tokenHash = hashToken(reset.token);

  if (!USE_DATABASE) {
    const resets = await readJsonFile(PASSWORD_RESETS_FILE, []);
    resets.push({
      id: reset.id,
      userId: reset.userId,
      tokenHash,
      expiresAt: reset.expiresAt,
      usedAt: reset.usedAt,
      createdAt: reset.createdAt,
    });
    await writeJsonFile(PASSWORD_RESETS_FILE, resets);
    return reset;
  }

  await pool.query(
    `INSERT INTO password_resets (id, user_id, token_hash, expires_at, used_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      reset.id,
      reset.userId,
      tokenHash,
      reset.expiresAt,
      reset.usedAt,
      reset.createdAt,
    ],
  );

  return reset;
}

async function resetPasswordWithToken({ token, passwordHash }) {
  const tokenHash = hashToken(token);
  const timestamp = nowIso();

  if (!USE_DATABASE) {
    const [users, sessions, resets] = await Promise.all([
      readJsonFile(USERS_FILE, []),
      readJsonFile(SESSIONS_FILE, []),
      readJsonFile(PASSWORD_RESETS_FILE, []),
    ]);
    const reset = resets.find((item) => item.tokenHash === tokenHash);

    if (!reset || reset.usedAt || new Date(reset.expiresAt) <= new Date()) {
      return false;
    }

    const user = users.find((item) => item.id === reset.userId);

    if (!user) {
      return false;
    }

    user.passwordHash = passwordHash;
    user.updatedAt = timestamp;
    reset.usedAt = timestamp;

    await Promise.all([
      writeJsonFile(USERS_FILE, users),
      writeJsonFile(
        SESSIONS_FILE,
        sessions.filter((session) => session.userId !== user.id),
      ),
      writeJsonFile(PASSWORD_RESETS_FILE, resets),
    ]);

    return true;
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const resetResult = await client.query(
      `SELECT *
       FROM password_resets
       WHERE token_hash = $1
         AND used_at IS NULL
         AND expires_at > NOW()
       FOR UPDATE`,
      [tokenHash],
    );
    const reset = resetResult.rows[0];

    if (!reset) {
      await client.query("ROLLBACK");
      return false;
    }

    await client.query(
      `UPDATE users
       SET password_hash = $2,
           updated_at = $3
       WHERE id = $1`,
      [reset.user_id, passwordHash, timestamp],
    );
    await client.query(
      `UPDATE password_resets
       SET used_at = $2
       WHERE id = $1`,
      [reset.id, timestamp],
    );
    await client.query(
      `DELETE FROM sessions
       WHERE user_id = $1`,
      [reset.user_id],
    );
    await client.query("COMMIT");

    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function changePasswordForUser({ userId, passwordHash }) {
  const timestamp = nowIso();

  if (!USE_DATABASE) {
    const [users, sessions] = await Promise.all([
      readJsonFile(USERS_FILE, []),
      readJsonFile(SESSIONS_FILE, []),
    ]);
    const user = users.find((item) => item.id === userId);

    if (!user) {
      return false;
    }

    user.passwordHash = passwordHash;
    user.updatedAt = timestamp;

    await Promise.all([
      writeJsonFile(USERS_FILE, users),
      writeJsonFile(
        SESSIONS_FILE,
        sessions.filter((session) => session.userId !== user.id),
      ),
    ]);

    return true;
  }

  const result = await pool.query(
    `UPDATE users
     SET password_hash = $2,
         updated_at = $3
     WHERE id = $1`,
    [userId, passwordHash, timestamp],
  );

  if (result.rowCount === 0) {
    return false;
  }

  await pool.query(
    `DELETE FROM sessions
     WHERE user_id = $1`,
    [userId],
  );

  return true;
}

async function deleteUserById(userId) {
  if (!USE_DATABASE) {
    const [users, sessions, projects, artifacts, resets] = await Promise.all([
      readJsonFile(USERS_FILE, []),
      readJsonFile(SESSIONS_FILE, []),
      readJsonFile(PROJECTS_FILE, []),
      readJsonFile(ARTIFACTS_FILE, []),
      readJsonFile(PASSWORD_RESETS_FILE, []),
    ]);
    const exists = users.some((user) => user.id === userId);

    if (!exists) {
      return false;
    }

    await Promise.all([
      writeJsonFile(
        USERS_FILE,
        users.filter((user) => user.id !== userId),
      ),
      writeJsonFile(
        SESSIONS_FILE,
        sessions.filter((session) => session.userId !== userId),
      ),
      writeJsonFile(
        PROJECTS_FILE,
        projects.filter((project) => project.ownerId !== userId),
      ),
      writeJsonFile(
        ARTIFACTS_FILE,
        artifacts.filter((artifact) => artifact.ownerId !== userId),
      ),
      writeJsonFile(
        PASSWORD_RESETS_FILE,
        resets.filter((reset) => reset.userId !== userId),
      ),
    ]);

    return true;
  }

  const result = await pool.query(
    `DELETE FROM users
     WHERE id = $1`,
    [userId],
  );

  return result.rowCount > 0;
}

async function deleteSessionByToken(token) {
  const tokenHash = hashToken(token);

  if (!USE_DATABASE) {
    const sessions = await readJsonFile(SESSIONS_FILE, []);
    const remainingSessions = sessions.filter((session) => session.token !== token);
    await writeJsonFile(SESSIONS_FILE, remainingSessions);
    return;
  }

  await pool.query(
    `DELETE FROM sessions
     WHERE token_hash = $1
        OR token = $2`,
    [tokenHash, token],
  );
}

async function deleteSessionsByUserId(userId) {
  if (!USE_DATABASE) {
    const sessions = await readJsonFile(SESSIONS_FILE, []);
    const remainingSessions = sessions.filter((session) => session.userId !== userId);
    await writeJsonFile(SESSIONS_FILE, remainingSessions);
    return;
  }

  await pool.query(
    `DELETE FROM sessions
     WHERE user_id = $1`,
    [userId],
  );
}

export {
  USE_DATABASE,
  ARTIFACTS_FILE,
  assignArtifactToProject,
  createArtifact,
  changePasswordForUser,
  createProject,
  createPasswordReset,
  createSession,
  createUser,
  deleteArtifact,
  deleteProjectByIdAndOwnerId,
  deleteUserById,
  deleteSessionByToken,
  deleteSessionsByUserId,
  getProjectByIdAndOwnerId,
  getArtifactByIdAndOwnerId,
  getStorageHealth,
  getUserById,
  getUserByEmail,
  getUserBySessionToken,
  initDatabase,
  listUsersForAdmin,
  listProjectsByOwnerId,
  listUnassignedArtifactsByOwnerId,
  mapArtifact,
  mapProject,
  pool,
  readJsonFile,
  resetPasswordWithToken,
  updateArtifact,
  updateOwnedArtifact,
  DATA_DIR,
  USERS_FILE,
  SESSIONS_FILE,
  PROJECTS_FILE,
  PASSWORD_RESETS_FILE,
  PHASE1_FILE,
  writeJsonFile,
};
