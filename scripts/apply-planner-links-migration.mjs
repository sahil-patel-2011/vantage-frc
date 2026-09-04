import { readFileSync } from "node:fs";
import pg from "pg";

const env = {};
for (const raw of readFileSync(new URL("../apps/web/.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const line = raw.trim();
  if (!line || line.startsWith("#") || !line.includes("=")) continue;
  const eq = line.indexOf("=");
  let value = line.slice(eq + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  env[line.slice(0, eq).trim()] = value;
}

const url = [env.DATABASE_ADMIN_URL, env.DATABASE_URL_UNPOOLED, env.DATABASE_URL]
  .map((value) => (value ?? "").trim())
  .find((value) => /^postgres(ql)?:\/\//i.test(value));
if (!url) {
  console.error("no admin/direct postgres URL");
  process.exit(1);
}

const id = "0524_planner_links.sql";
const pool = new pg.Pool({
  connectionString: url,
  max: 1,
  ssl: { rejectUnauthorized: true },
});

const exists = await pool.query("SELECT 1 FROM schema_migrations WHERE id=$1", [id]);
if (exists.rowCount) {
  console.log("already applied", id);
  await pool.end();
  process.exit(0);
}

const sql = readFileSync(new URL(`../packages/db/migrations/${id}`, import.meta.url), "utf8");
await pool.query(sql);
await pool.query("INSERT INTO schema_migrations (id) VALUES ($1)", [id]);
console.log("applied", id);
await pool.end();
