import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

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
const sql = neon(env.DATABASE_URL);
const orgId = "186677b7-122c-4d11-9978-a2845d3df048";
const tables = [
  "org_billing",
  "org_usage_policies",
  "ai_usage_reservations",
  "org_model_policy",
  "ai_bridge_devices",
  "org_member_funding_policies",
  "ai_runs",
  "credit_ledger",
  "ai_request_credit_ledger",
];
const present = {};
for (const name of tables) {
  const rows = await sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ${name}
    ) AS ok
  `;
  present[name] = rows[0].ok;
}
const billing = await sql`SELECT tier, kill_switch FROM org_billing WHERE org_id = ${orgId} LIMIT 1`;
console.log(JSON.stringify({ present, billingRows: billing.length, tier: billing[0]?.tier ?? null }, null, 2));
