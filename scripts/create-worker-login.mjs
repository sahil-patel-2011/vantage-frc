#!/usr/bin/env node
// Operator-only: create a limited production worker login and keep its URL out of stdout.
import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import pg from "pg";

const [envPath, outputPath, flag] = process.argv.slice(2);
if (!envPath || !outputPath || flag !== "--create") {
  throw new Error("Usage: node scripts/create-worker-login.mjs <private-env-file> <private-output-file> --create");
}
const env = Object.fromEntries(readFileSync(envPath, "utf8").split(/\r?\n/)
  .filter((line) => /^[A-Z_][A-Z0-9_]*=/.test(line))
  .map((line) => {
    const i = line.indexOf("=");
    let value = line.slice(i + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    return [line.slice(0, i), value];
  }));
const adminUrl = [env.DATABASE_ADMIN_URL, env.DATABASE_URL_UNPOOLED, env.POSTGRES_URL_NON_POOLING]
  .find((value) => value?.startsWith("postgres") && !value.includes("[SENSITIVE]"));
if (!adminUrl) throw new Error("A direct database URL is unavailable.");

const admin = new pg.Client({ connectionString: adminUrl });
await admin.connect();
let worker;
try {
  const existing = await admin.query("SELECT 1 FROM pg_roles WHERE rolname='vantage_worker_login'");
  if (existing.rowCount) throw new Error("Worker login already exists; verify its saved connection instead of rotating it implicitly.");
  const password = randomBytes(32).toString("base64url");
  await admin.query(`CREATE ROLE vantage_worker_login LOGIN PASSWORD '${password}' IN ROLE vantage_worker`);
  const url = new URL(adminUrl);
  url.username = "vantage_worker_login";
  url.password = password;
  worker = new pg.Client({ connectionString: url.toString() });
  await worker.connect();
  const check = (await worker.query("SELECT current_user AS role,pg_has_role(current_user,'vantage_worker','member') AS limited_worker,to_regclass('public.recovery_events')::text AS journal")).rows[0];
  if (check.role !== "vantage_worker_login" || !check.limited_worker || !check.journal) throw new Error("Worker role did not pass access checks.");
  await worker.query("SELECT id FROM recovery_events LIMIT 1");
  writeFileSync(outputPath, url.toString(), { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ role: check.role, limitedWorker: true, journalReadable: true, saved: true }));
} finally {
  await worker?.end();
  await admin.end();
}
