import path from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";
import crypto from "crypto";
import pg from "pg";

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const USERS_FILE = path.join(__dirname, "data", "users.json");
const SESSIONS_FILE = path.join(__dirname, "data", "sessions.json");
const PROJECTS_FILE = path.join(__dirname, "data", "projects.json");

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
    templateId: row.template_id,
    title: row.title,
    status: row.status,
    fieldValues: row.field_values || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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

function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso() {
  return new Date().toISOString();
}

async function initDatabase() {
  if (!USE_DATABASE) {
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      sponsor TEXT NOT NULL DEFAULT '',
      objective TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      template_id TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      field_values JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_projects_owner_id ON projects(owner_id);
    CREATE INDEX IF NOT EXISTS idx_artifacts_project_id ON artifacts(project_id);
  `);
}

async function listProjectsByOwnerId(ownerId) {
  if (!USE_DATABASE) {
    const projects = await readJsonFile(PROJECTS_FILE, []);
    return projects.filter((project) => project.ownerId === ownerId);
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
    return (
      projects.find(
        (project) => project.id === projectId && project.ownerId === ownerId,
      ) || null
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

async function createArtifact({ projectId, ownerId, templateId, title, fieldValues }) {
  const timestamp = nowIso();
  const artifact = {
    id: createId("artifact"),
    templateId,
    title,
    status: "draft",
    fieldValues,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  if (!USE_DATABASE) {
    const projects = await readJsonFile(PROJECTS_FILE, []);
    const project = projects.find(
      (item) => item.id === projectId && item.ownerId === ownerId,
    );

    if (!project) {
      return null;
    }

    project.artifacts.unshift(artifact);
    project.updatedAt = timestamp;
    await writeJsonFile(PROJECTS_FILE, projects);
    return artifact;
  }

  const ownership = await pool.query(
    `SELECT id
     FROM projects
     WHERE id = $1 AND owner_id = $2`,
    [projectId, ownerId],
  );

  if (!ownership.rows[0]) {
    return null;
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO artifacts (id, project_id, template_id, title, status, field_values, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
      [
        artifact.id,
        projectId,
        artifact.templateId,
        artifact.title,
        artifact.status,
        JSON.stringify(artifact.fieldValues),
        artifact.createdAt,
        artifact.updatedAt,
      ],
    );
    await client.query(
      `UPDATE projects
       SET updated_at = $2
       WHERE id = $1`,
      [projectId, timestamp],
    );
    await client.query("COMMIT");
    return artifact;
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

    artifact.title = title;
    artifact.status = status;
    artifact.fieldValues = fieldValues;
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
           updated_at = $6
       WHERE id = $1 AND project_id = $2
       RETURNING *`,
      [
        artifactId,
        projectId,
        title,
        status,
        JSON.stringify(fieldValues),
        timestamp,
      ],
    );

    if (!result.rows[0]) {
      await client.query("ROLLBACK");
      return { projectFound: true, artifact: null };
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

async function getUserBySessionToken(token) {
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
     WHERE s.token = $1`,
    [token],
  );

  return result.rows[0] || null;
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
    createdAt: nowIso(),
  };

  if (!USE_DATABASE) {
    const sessions = await readJsonFile(SESSIONS_FILE, []);
    sessions.push(session);
    await writeJsonFile(SESSIONS_FILE, sessions);
    return session;
  }

  await pool.query(
    `INSERT INTO sessions (id, user_id, token, created_at)
     VALUES ($1, $2, $3, $4)`,
    [session.id, session.userId, session.token, session.createdAt],
  );

  return session;
}

async function deleteSessionByToken(token) {
  if (!USE_DATABASE) {
    const sessions = await readJsonFile(SESSIONS_FILE, []);
    const remainingSessions = sessions.filter((session) => session.token !== token);
    await writeJsonFile(SESSIONS_FILE, remainingSessions);
    return;
  }

  await pool.query(
    `DELETE FROM sessions
     WHERE token = $1`,
    [token],
  );
}

export {
  USE_DATABASE,
  createArtifact,
  createProject,
  createSession,
  createUser,
  deleteArtifact,
  deleteProjectByIdAndOwnerId,
  deleteSessionByToken,
  getProjectByIdAndOwnerId,
  getUserByEmail,
  getUserBySessionToken,
  initDatabase,
  listProjectsByOwnerId,
  mapArtifact,
  mapProject,
  pool,
  readJsonFile,
  updateArtifact,
  USERS_FILE,
  SESSIONS_FILE,
  PROJECTS_FILE,
  writeJsonFile,
};
