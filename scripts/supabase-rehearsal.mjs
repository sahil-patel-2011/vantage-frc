#!/usr/bin/env node
/**
 * Scratch-database rehearsal for a future Supabase cutover.
 *
 * Does not connect to the owner's projects. When SUPABASE_PAID_DATABASE_URL
 * (or DATABASE_ADMIN_URL) is set, applies migrations and runs the RLS proof.
 * Identity stays Better Auth + withRls. Never uses anon/service_role keys.
 *
 *   node scripts/supabase-rehearsal.mjs
 */
import { spawnSync } from "node:child_process";

const url =
  process.env.SUPABASE_PAID_DATABASE_URL ||
  process.env.DATABASE_ADMIN_URL ||
  "";

console.log("Supabase rehearsal (connect nothing to production).");
console.log("Identity stays Better Auth + withRls. Do not paste Data API keys.");
console.log("");

if (!url) {
  console.log("SKIP: no SUPABASE_PAID_DATABASE_URL or DATABASE_ADMIN_URL.");
  console.log("When the owner pastes a scratch Postgres URL:");
  console.log("  1. DATABASE_ADMIN_URL=… node scripts/run-migrations.mjs");
  console.log("  2. RLS_PROOF_SUPERUSER_URL=… RLS_PROOF_APP_URL=… node scripts/rls-proof.mjs");
  console.log("  3. node scripts/supabase-preflight.mjs");
  process.exit(0);
}

console.log("Applying migrations…");
const migrate = spawnSync(process.execPath, ["scripts/run-migrations.mjs"], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_ADMIN_URL: url },
});
if (migrate.status !== 0) process.exit(migrate.status ?? 1);

if (process.env.RLS_PROOF_APP_URL && process.env.RLS_PROOF_SUPERUSER_URL) {
  console.log("Running RLS proof…");
  const proof = spawnSync(process.execPath, ["scripts/rls-proof.mjs"], {
    stdio: "inherit",
    env: process.env,
  });
  if (proof.status !== 0) process.exit(proof.status ?? 1);
} else {
  console.log("SKIP RLS proof: set RLS_PROOF_SUPERUSER_URL and RLS_PROOF_APP_URL.");
}
console.log("Rehearsal finished.");
