import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.join(__dirname, "db", "migrations");
const MIGRATION_LOCK_ID = 417_202_606;

function checksum(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function loadMigrations() {
  const files = (await fs.readdir(MIGRATIONS_DIR))
    .filter((file) => /^\d{3}_.+\.sql$/.test(file))
    .sort();

  return Promise.all(
    files.map(async (file) => {
      const sql = await fs.readFile(path.join(MIGRATIONS_DIR, file), "utf-8");
      return {
        version: Number(file.slice(0, 3)),
        name: file,
        checksum: checksum(sql),
        sql,
      };
    }),
  );
}

async function runMigrations(pool) {
  const client = await pool.connect();

  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const appliedResult = await client.query(
      "SELECT version, checksum FROM schema_migrations ORDER BY version",
    );
    const applied = new Map(
      appliedResult.rows.map((row) => [Number(row.version), row.checksum]),
    );

    for (const migration of await loadMigrations()) {
      const appliedChecksum = applied.get(migration.version);

      if (appliedChecksum && appliedChecksum !== migration.checksum) {
        throw new Error(
          `Migration ${migration.name} checksum does not match the applied migration.`,
        );
      }

      if (appliedChecksum) {
        continue;
      }

      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query(
          `INSERT INTO schema_migrations (version, name, checksum)
           VALUES ($1, $2, $3)`,
          [migration.version, migration.name, migration.checksum],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]);
    client.release();
  }
}

export { loadMigrations, runMigrations };
