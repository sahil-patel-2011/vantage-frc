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

const wanted = [
  "0517_ai_usage_reservations.sql",
  "0518_key_source_platform_grant.sql",
  "0519_platform_free_ai_prefs.sql",
  "0520_free_relay_devices.sql",
  "0521_deep_game_analysis.sql",
  "0522_deep_analysis_continuous_models.sql",
  "0523_ai_free_token_gifts.sql",
];

const pool = new pg.Pool({
  connectionString: url,
  max: 1,
  ssl: { rejectUnauthorized: true },
});

const applied = await pool.query(
  `SELECT id FROM schema_migrations WHERE id = ANY($1::text[])`,
  [wanted],
);
const have = new Set(applied.rows.map((row) => row.id));
console.log(`already=${[...have].join(",") || "none"}`);

for (const file of wanted) {
  if (have.has(file)) {
    console.log("SKIP", file);
    continue;
  }
  const sql = readFileSync(new URL(`../packages/db/migrations/${file}`, import.meta.url), "utf8");
  await pool.query("BEGIN");
  try {
    await pool.query(sql);
    await pool.query(`INSERT INTO schema_migrations(id) VALUES ($1)`, [file]);
    await pool.query("COMMIT");
    console.log("APPLY", file);
  } catch (error) {
    await pool.query("ROLLBACK");
    console.error("FAIL", file, error.message);
    await pool.end();
    process.exit(1);
  }
}

await pool.end();
console.log("done");
