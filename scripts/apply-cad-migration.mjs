import { readFileSync, unlinkSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "@neondatabase/serverless";

const envPath = resolve("apps/web/.env.migrate.tmp");
if (!existsSync(envPath)) {
  console.error("Missing apps/web/.env.migrate.tmp — pull with vercel env pull first");
  process.exit(1);
}
const raw = readFileSync(envPath, "utf8");
const env = Object.fromEntries(
  raw
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((line) => !line.startsWith("#"))
    .map((line) => {
      const i = line.indexOf("=");
      let value = line.slice(i + 1);
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      return [line.slice(0, i), value];
    }),
);

const url = env.DATABASE_ADMIN_URL || env.DATABASE_URL;
if (!url) {
  console.error("No admin DB URL");
  process.exit(1);
}

const pool = new Pool({ connectionString: url });
const file = "packages/db/migrations/0030_key_source_local_cli.sql";
try {
  await pool.query(readFileSync(file, "utf8"));
  console.log("Applied", file);
} catch (error) {
  console.error("Failed", file, error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
await pool.end();
try {
  unlinkSync(envPath);
  console.log("Removed temp env file");
} catch {
  // ignore
}
