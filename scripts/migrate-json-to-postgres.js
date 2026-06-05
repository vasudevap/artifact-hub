import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
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

async function migrate() {
  if (!USE_DATABASE) {
    throw new Error("DATABASE_URL is required to run the migration.");
  }

  await initDatabase();

  const [users, sessions, projects] = await Promise.all([
    readJson("data/users.json", []),
    readJson("data/sessions.json", []),
    readJson("data/projects.json", []),
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
        `INSERT INTO sessions (id, user_id, token, created_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE
         SET user_id = EXCLUDED.user_id,
             token = EXCLUDED.token,
             created_at = EXCLUDED.created_at`,
        [session.id, session.userId, session.token, session.createdAt],
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
        await client.query(
          `INSERT INTO artifacts (id, project_id, template_id, title, status, field_values, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
           ON CONFLICT (id) DO UPDATE
           SET project_id = EXCLUDED.project_id,
               template_id = EXCLUDED.template_id,
               title = EXCLUDED.title,
               status = EXCLUDED.status,
               field_values = EXCLUDED.field_values,
               created_at = EXCLUDED.created_at,
               updated_at = EXCLUDED.updated_at`,
          [
            artifact.id,
            project.id,
            artifact.templateId,
            artifact.title,
            artifact.status,
            JSON.stringify(artifact.fieldValues || {}),
            artifact.createdAt,
            artifact.updatedAt,
          ],
        );
      }
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
