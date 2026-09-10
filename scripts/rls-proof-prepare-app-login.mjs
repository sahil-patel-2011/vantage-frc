#!/usr/bin/env node
// Create (or reset) the non-superuser LOGIN that scripts/rls-proof.mjs needs.
// A superuser bypasses every policy, so the proof login must be GRANT vantage_app
// + ALTER ROLE … SET ROLE vantage_app, never BYPASSRLS.
//
// Usage (scratch database that already has migrations applied):
//   RLS_PROOF_SUPERUSER_URL=postgres://postgres:...@host/db \
//   RLS_PROOF_APP_URL=postgres://vantage_ci_app:app@host/db \
//   node scripts/rls-proof-prepare-app-login.mjs
import { Client } from "pg";

const SET_ROLE = (process.env.RLS_PROOF_SET_ROLE ?? "vantage_app").trim();
const ALLOWED_SET_ROLES = new Set(["vantage_app", "vantage_auth"]);
if (!ALLOWED_SET_ROLES.has(SET_ROLE)) {
  console.error(`RLS_PROOF_SET_ROLE must be vantage_app or vantage_auth (got ${SET_ROLE}).`);
  process.exit(2);
}

const SU = process.env.RLS_PROOF_SUPERUSER_URL;
const APP = process.env.RLS_PROOF_APP_URL;
if (!SU || !APP) {
  console.error("Set RLS_PROOF_SUPERUSER_URL and RLS_PROOF_APP_URL (a scratch database, never production).");
  process.exit(2);
}

const app = new URL(APP);
const login = decodeURIComponent(app.username);
const password = decodeURIComponent(app.password);
const database = decodeURIComponent(app.pathname.replace(/^\//, ""));
if (!/^[a-z][a-z0-9_]*$/.test(login)) {
  console.error(`RLS_PROOF_APP_URL login ${login} is not a safe role name.`);
  process.exit(2);
}
if (login === "postgres" || login === "vantage_worker") {
  console.error(`RLS_PROOF_APP_URL login ${login} cannot prove RLS.`);
  process.exit(2);
}
if (!password) {
  console.error("RLS_PROOF_APP_URL must include a password.");
  process.exit(2);
}

const su = new Client(SU);
await su.connect();

async function execFormat(template, params) {
  const allowed = new Set([
    "CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS INHERIT",
    "ALTER ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS INHERIT",
    "GRANT vantage_app TO %I",
    "GRANT vantage_auth TO %I",
    "ALTER ROLE %I SET ROLE vantage_app",
    "ALTER ROLE %I SET ROLE vantage_auth",
    "GRANT CONNECT ON DATABASE %I TO %I",
    "GRANT USAGE ON SCHEMA public TO %I",
  ]);
  if (!allowed.has(template)) {
    throw new Error(`refusing format template: ${template}`);
  }
  const placeholders = params.map((_, i) => `$${i + 1}::text`).join(", ");
  const formatted = await su.query(
    `SELECT format($fmt$${template}$fmt$, ${placeholders}) AS q`,
    params,
  );
  await su.query(formatted.rows[0].q);
}

try {
  const existing = await su.query(`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1`, [login]);
  if (!existing.rowCount) {
    await execFormat("CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS INHERIT", [login, password]);
  } else {
    await execFormat("ALTER ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS INHERIT", [login, password]);
  }
  await execFormat(`GRANT ${SET_ROLE} TO %I`, [login]);
  await execFormat(`ALTER ROLE %I SET ROLE ${SET_ROLE}`, [login]);
  if (database) await execFormat("GRANT CONNECT ON DATABASE %I TO %I", [database, login]);
  await execFormat("GRANT USAGE ON SCHEMA public TO %I", [login]);
  const who = await su.query(`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1`, [login]);
  if (!who.rowCount || who.rows[0].rolsuper || who.rows[0].rolbypassrls) {
    throw new Error(`${login} is still superuser or BYPASSRLS after prepare`);
  }
  console.log(`prepared ${login} as ${SET_ROLE} (NOSUPERUSER, NOBYPASSRLS)`);
} finally {
  await su.end();
}
