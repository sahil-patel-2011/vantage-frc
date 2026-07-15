import { Pool } from "@neondatabase/serverless";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function loadEnv(path) {
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    let value = line.slice(i + 1);
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[line.slice(0, i)] = value;
  }
  return out;
}

const env = {
  ...loadEnv(".env.production.local"),
  ...loadEnv(".env.migrate.local"),
};
const url = env.DATABASE_ADMIN_URL || env.DATABASE_URL_UNPOOLED || env.DATABASE_URL;
if (!url) {
  console.error("NO_DB_URL");
  process.exit(1);
}

const dir = "packages/db/migrations";
const files = readdirSync(dir)
  .filter((name) => name.endsWith(".sql"))
  .sort();

const pool = new Pool({ connectionString: url });
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
