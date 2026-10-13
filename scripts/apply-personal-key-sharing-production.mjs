// Explicit, one-release operation. Run before the normal read-only schema gate.
// Only migration 0734 is applied; existing personal keys default to private use.
import pg from "pg";
import { readFileSync } from "node:fs";
import { pgTlsOptions } from "./lib/database-ssl.mjs";

const migration = "0734_personal_ai_key_sharing.sql";
const url = process.env.DATABASE_ADMIN_URL;
let host = "";
try { host = new URL(url).hostname; } catch { /* Report a safe diagnostic below. */ }
if (process.argv[2] !== "--apply-0734" || process.env.VERCEL_ENV !== "production" || process.env.VERCEL !== "1" || !host.endsWith(".supabase.com")) {
  console.error("Migration 0734 requires an explicit production Vercel release against the existing Supabase database.");
  process.exit(2);
}
const pool = new pg.Pool({ ...pgTlsOptions(url), max: 1, connectionTimeoutMillis: 10_000 });
let client;
try {
  client = await pool.connect();
  await client.query("BEGIN");
  await client.query("SET LOCAL lock_timeout = '10s'");
  await client.query("SET LOCAL statement_timeout = '60s'");
  await client.query("SELECT pg_advisory_xact_lock(hashtext('vantage-migrations'))");
  const applied = await client.query("SELECT 1 FROM public.schema_migrations WHERE id=$1", [migration]);
  if (!applied.rowCount) {
    await client.query(readFileSync(new URL(`../packages/db/migrations/${migration}`, import.meta.url), "utf8"));
    await client.query("INSERT INTO public.schema_migrations(id) VALUES($1)", [migration]);
  }
  await client.query("COMMIT");
  console.log(JSON.stringify({ migration, status: applied.rowCount ? "already applied" : "applied", existingKeys: "private by default" }));
} catch {
  if (client) await client.query("ROLLBACK").catch(() => undefined);
  console.error("Migration 0734 did not complete. Production release must remain blocked; check the configured migration connection.");
  process.exitCode = 1;
} finally {
  client?.release();
  await pool.end();
}
