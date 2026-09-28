#!/usr/bin/env node
// Read-only operator check. Prints migration IDs and database role, never credentials.
import { readFileSync, readdirSync } from "node:fs";
import pg from "pg";

const path = process.argv[2];
if (!path) throw new Error("Provide a private production env file path.");
const env = Object.fromEntries(readFileSync(path, "utf8").split(/\r?\n/)
  .filter((line) => /^[A-Z_][A-Z0-9_]*=/.test(line))
  .map((line) => {
    const index = line.indexOf("=");
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    return [line.slice(0, index), value];
  }));
const url = [env.DATABASE_ADMIN_URL, env.DATABASE_URL_UNPOOLED, env.POSTGRES_URL_NON_POOLING]
  .find((value) => value?.startsWith("postgres") && !value.includes("[SENSITIVE]"));
if (!url) throw new Error("A direct database URL is unavailable.");
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const metadata = (await client.query("SELECT current_user AS role,current_database() AS database,to_regclass('public.team_provisioning_jobs')::text AS provisioning_table,to_regclass('public.recovery_events')::text AS recovery_table")).rows[0];
  const applied = new Set((await client.query("SELECT id FROM schema_migrations ORDER BY id")).rows.map((row) => row.id));
  const files = readdirSync("packages/db/migrations").filter((name) => name.endsWith(".sql")).sort();
  const pending = files.filter((name) => !applied.has(name));
  const workerRoles = (await client.query("SELECT rolname,rolcanlogin FROM pg_roles WHERE rolname IN ('vantage_worker','vantage_worker_login') ORDER BY rolname")).rows;
  const canCreateRole = (await client.query("SELECT rolcreaterole FROM pg_roles WHERE rolname=current_user")).rows[0]?.rolcreaterole;
  console.log(JSON.stringify({ ...metadata, workerRoles, canCreateRole, applied: applied.size, available: files.length, pending }));
} finally {
  await client.end();
}
