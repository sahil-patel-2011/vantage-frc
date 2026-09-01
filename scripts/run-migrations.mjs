import pg from "pg";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function parseEnvFile(path) {
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    const name = line.slice(0, i).trim();
    let value = line.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[name] = value;
  }
  return out;
}

const args = process.argv.slice(2);
const envFileIndex = args.indexOf("--migration-env-file");
const explicitEnvFile = envFileIndex >= 0 ? args[envFileIndex + 1] : undefined;
if (envFileIndex >= 0 && !explicitEnvFile) {
  console.error("--migration-env-file requires a path");
  process.exit(1);
}

const envFiles = explicitEnvFile
  ? [explicitEnvFile]
  : [".env.production.local", ".env.migrate.local"].filter((path) => existsSync(path));
const fileEnv = {};
for (const path of envFiles) {
  if (!existsSync(path)) {
    console.error(`ENV_FILE_NOT_FOUND ${path}`);
    process.exit(1);
  }
  Object.assign(fileEnv, parseEnvFile(path));
}

// Explicit shell/CI variables win over local files.
const env = { ...fileEnv, ...process.env };
const url =
  env.DATABASE_ADMIN_URL ||
  env.DATABASE_URL_UNPOOLED ||
  env.POSTGRES_URL_NON_POOLING ||
  env.DATABASE_URL ||
  env.POSTGRES_URL;
if (!url) {
  console.error(
    "NO_DB_URL: set DATABASE_ADMIN_URL (preferred) or a documented direct-connection alias",
  );
  process.exit(1);
}

const dir = "packages/db/migrations";
const files = readdirSync(dir)
  .filter((name) => name.endsWith(".sql"))
  .sort();

const pool = new pg.Pool({
  connectionString: url,
  max: 1,
  ssl: ["localhost", "127.0.0.1", "::1"].includes(new URL(url).hostname)
    ? false
    : { rejectUnauthorized: true },
});
await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
  id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
)`);

for (const file of files) {
  const id = file;
  const exists = await pool.query(`SELECT 1 FROM schema_migrations WHERE id=$1`, [id]);
  if (exists.rowCount) {
    console.log("SKIP", id);
    continue;
  }
  const sql = readFileSync(join(dir, file), "utf8");
  console.log("APPLY", id);
  try {
    await pool.query("BEGIN");
    await pool.query(sql);
    await pool.query(`INSERT INTO schema_migrations(id) VALUES($1)`, [id]);
    await pool.query("COMMIT");
    console.log("OK", id);
  } catch (error) {
    await pool.query("ROLLBACK");
    console.error("FAIL", id, error instanceof Error ? error.message : error);
    writeFileSync(
      "scripts/migration-failures.log",
      `${id}\n${error instanceof Error ? error.message : String(error)}\n`,
      { flag: "a" },
    );
    process.exitCode = 1;
    break;
  }
}

await pool.end();
