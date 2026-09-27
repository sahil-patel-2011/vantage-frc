#!/usr/bin/env node
// Acceptance preflight is stricter than the development setup-required checks.
// Secret values never appear in its output. Protected Vercel placeholders are unverified.
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { parseEnvFile } from "./deploy-preflight.mjs";

export const RELEASE_SETTINGS = [
  "DATABASE_URL", "DATABASE_AUTH_URL", "DATABASE_WORKER_URL", "DATABASE_AI_BRIDGE_URL",
  "BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_SITE_URL",
  "CRON_SECRET", "TBA_AUTH_KEY",
  "RECOVERY_ENCRYPTION_KEY", "EXPORT_ENCRYPTION_KEY", "MFA_ENCRYPTION_KEY", "MFA_RECOVERY_PEPPER",
  "VANTAGE_SHEETS_HUB_SECRET", "RATE_LIMIT_REDIS_URL", "RATE_LIMIT_REDIS_TOKEN",
];
const aliases = { DATABASE_URL: ["POSTGRES_URL"], DATABASE_AI_BRIDGE_URL: ["DATABASE_CAD_RELAY_URL"], TBA_AUTH_KEY: ["TBA_API_KEY"] };
const valueFor = (env, name) => [name, ...(aliases[name] ?? [])].map((key) => env[key]?.trim()).find(Boolean);
const protectedValue = (value) => /\[SENSITIVE\]|\[REDACTED\]/i.test(value ?? "");

/** Match the runtime's two supported production email providers without treating redacted keys as verified. */
export function checkEmailDelivery(env) {
  const first = (...keys) => keys.map(key => env[key]?.trim()).find(Boolean);
  const smtp = [first("GMAIL_SMTP_USER", "GMAIL_USER", "SMTP_USER", "SMTP_USERNAME"), first("GMAIL_SMTP_APP_PASSWORD", "GMAIL_APP_PASSWORD", "SMTP_PASSWORD", "SMTP_PASS")];
  const resend = [first("RESEND_API_KEY", "RESEND_KEY"), first("AUTH_EMAIL_FROM", "EMAIL_FROM", "MAIL_FROM", "FROM_EMAIL")];
  const pairs = [smtp, ...(!resend[1] || protectedValue(resend[1]) || !/@(gmail|googlemail|yahoo|outlook|hotmail|live|icloud|msn)\./i.test(resend[1]) ? [resend] : [])];
  const configured = pairs.some(pair => pair.every(value => value && !protectedValue(value)));
  const protectedPair = pairs.some(pair => pair.every(Boolean));
  return { name: "EMAIL_DELIVERY", status: configured ? "PASS" : protectedPair ? "UNVERIFIED" : "FAIL",
    note: configured ? "A supported email provider is configured; live delivery acceptance remains required."
      : protectedPair ? "Email provider settings are present but protected; verify live delivery."
      : "Configure Gmail SMTP credentials or a Resend key with a non-consumer sender address." };
}

export function checkReleaseSettings(env) {
  const rows = RELEASE_SETTINGS.map((name) => {
    const value = valueFor(env, name);
    if (!value) return { name, status: "FAIL", note: "Required platform setting is missing." };
    if (protectedValue(value)) return { name, status: "UNVERIFIED", note: "Protected value requires runtime verification; metadata presence is insufficient." };
    if (name === "RECOVERY_ENCRYPTION_KEY" && Buffer.from(value, "base64").length !== 32) return { name, status: "FAIL", note: "A 32-byte encryption key encoded as base64 is required." };
    if (name === "VANTAGE_SHEETS_HUB_SECRET" && !/^[a-f0-9]{64}$/i.test(value)) return { name, status: "FAIL", note: "The signed operator bridge requires a 64-character hexadecimal secret." };
    if (["BETTER_AUTH_SECRET", "CRON_SECRET", "MFA_RECOVERY_PEPPER", "MFA_ENCRYPTION_KEY", "EXPORT_ENCRYPTION_KEY"].includes(name) && value.length < 32) return { name, status: "FAIL", note: "Use a secret with at least 32 characters." };
    if (["BETTER_AUTH_URL", "NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_SITE_URL", "RATE_LIMIT_REDIS_URL"].includes(name)) {
      try { if (new URL(value).protocol !== "https:") throw new Error(); }
      catch { return { name, status: "FAIL", note: "A production HTTPS URL is required." }; }
    }
    return { name, status: "PASS", note: "Configured; live workflow acceptance remains required." };
  });
  rows.push(checkEmailDelivery(env));
  for (const name of ["E2E_AUTH_FIXTURE", "DEV_KMS_MASTER_KEY", "DEV_OTP_SECRET", "ENABLE_EMAIL_2FA_BYPASS"]) if (env[name]?.trim()) rows.push({ name, status: "FAIL", note: "Development or bypass configuration is forbidden for release." });
  if (env.VANTAGE_SHEETS_HUB_SHARE?.trim() === "1") rows.push({ name: "VANTAGE_SHEETS_HUB_SHARE", status: "FAIL", note: "Operator workbooks must remain private by default." });
  if (env.VANTAGE_PUBLIC_SIGNUP === "open" && env.VANTAGE_PRODUCTION_VERIFIED !== "1") rows.push({ name: "VANTAGE_PUBLIC_SIGNUP", status: "FAIL", note: "Signup cannot open before production acceptance." });
  return rows;
}

const ROLE_SETTINGS = [
  ["DATABASE_URL", "vantage_app"], ["DATABASE_AUTH_URL", "vantage_auth"],
  ["DATABASE_WORKER_URL", "vantage_worker"], ["DATABASE_AI_BRIDGE_URL", "vantage_pairing"],
];
export async function checkRuntimeDatabaseRoles(env) {
  const rows = [];
  for (const [name, role] of ROLE_SETTINGS) {
    const connection = valueFor(env, name);
    if (!connection || protectedValue(connection)) { rows.push({ name: `${name} role`, status: "UNVERIFIED", note: "A readable dedicated runtime connection is required for role verification." }); continue; }
    const client = new pg.Client({ connectionString: connection, connectionTimeoutMillis: 5000, statement_timeout: 5000 });
    try {
      await client.connect();
      await client.query("BEGIN READ ONLY");
      const row = (await client.query(`SELECT r.rolsuper,r.rolbypassrls,pg_has_role(current_user,$1,'USAGE') AS expected_role,
        EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
          AND c.relkind IN ('r','p') AND pg_has_role(current_user,c.relowner,'USAGE')) AS owns_tables
        FROM pg_roles r WHERE r.rolname=current_user`, [role])).rows[0];
      const pass = row?.expected_role && !row.rolsuper && !row.rolbypassrls && !row.owns_tables;
      rows.push({ name: `${name} role`, status: pass ? "PASS" : "FAIL", note: pass ? `Verified restricted ${role} connection.` : "Runtime connection has excessive privileges or lacks the expected role." });
    } catch { rows.push({ name: `${name} role`, status: "FAIL", note: "Runtime database role could not be verified." }); }
    finally { try { await client.query("ROLLBACK"); } catch { /* connection may have failed */ } await client.end(); }
  }
  return rows;
}

async function main() {
  const index = process.argv.indexOf("--env-file");
  const env = index >= 0 ? parseEnvFile(await readFile(process.argv[index + 1], "utf8")) : process.env;
  const rows = [...checkReleaseSettings(env), ...await checkRuntimeDatabaseRoles(env)];
  console.log(JSON.stringify({ scope: "platform settings and database roles; does not establish product acceptance", rows }, null, 2));
  if (rows.some((row) => row.status !== "PASS")) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
