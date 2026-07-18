/**
 * Map Neon / Vercel Postgres connection strings into the role-specific env
 * aliases Vantage expects in production.
 *
 * Source (from Neon integration or .env.production.local):
 *   DATABASE_URL / POSTGRES_URL              → pooled (PgBouncer) app URL
 *   DATABASE_URL_UNPOOLED / POSTGRES_URL_NON_POOLING → direct / unpooled
 *
 * Writes to Vercel Production (when `vercel` CLI is available) and always
 * refreshes `.env.migrate.local` for `scripts/run-migrations.mjs`.
 *
 * Required Vercel aliases (Production + Preview if product routes run there):
 *   DATABASE_URL                 pooled product request role (RLS)
 *   DATABASE_AUTH_URL            same pooled URL (Better Auth / session DB)
 *   DATABASE_ADMIN_URL           UNPOOLED — migrations + workers only
 *   MARKETING_DATABASE_URL       marketing Neon role (or pooled until split)
 *   DATABASE_BILLING_URL         Stripe webhook role (or pooled until split)
 *   DATABASE_DISPLAY_URL         pit-TV snapshot execute-only (or pooled)
 *   DATABASE_ALLIANCE_BOARD_URL  alliance-board share execute-only (or pooled)
 *   DATABASE_CAD_RELAY_URL       CAD Fusion relay pairing (or pooled)
 *
 * Never commit real connection strings. Prefer Neon role URLs when provisioned;
 * until then aliases may point at the same pooled/unpooled strings.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

function loadEnv(path) {
  const out = {};
  try {
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      if (!line || line.startsWith("#")) continue;
      const i = line.indexOf("=");
      if (i < 0) continue;
      let value = line.slice(i + 1);
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      out[line.slice(0, i)] = value;
    }
  } catch {
    // optional file
  }
  return out;
}

const env = loadEnv(".env.production.local");
const pooled = env.DATABASE_URL || env.POSTGRES_URL;
const unpooled = env.DATABASE_URL_UNPOOLED || env.POSTGRES_URL_NON_POOLING || pooled;
if (!pooled) {
  console.error("NO_DATABASE_URL");
  process.exit(1);
}

function add(key, value) {
  const result = spawnSync("vercel", ["env", "add", key, "production", "--yes"], {
    input: `${value}\n`,
    encoding: "utf8",
  });
  const text = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const ok = result.status === 0 || /already exists|Added/i.test(text);
  console.log(key, ok ? "OK" : "FAIL");
  if (!ok) console.log(text.split(/\r?\n/).slice(0, 6).join(" | "));
}

const aliases = [
  ["DATABASE_AUTH_URL", env.DATABASE_AUTH_URL || pooled],
  ["DATABASE_ADMIN_URL", env.DATABASE_ADMIN_URL || unpooled],
  ["MARKETING_DATABASE_URL", env.MARKETING_DATABASE_URL || pooled],
  ["DATABASE_BILLING_URL", env.DATABASE_BILLING_URL || pooled],
  ["DATABASE_DISPLAY_URL", env.DATABASE_DISPLAY_URL || pooled],
  ["DATABASE_ALLIANCE_BOARD_URL", env.DATABASE_ALLIANCE_BOARD_URL || pooled],
  ["DATABASE_CAD_RELAY_URL", env.DATABASE_CAD_RELAY_URL || pooled],
];

for (const [key, value] of aliases) {
  add(key, value);
}

writeFileSync(
  ".env.migrate.local",
  [
    `DATABASE_ADMIN_URL=${JSON.stringify(unpooled)}`,
    `DATABASE_URL=${JSON.stringify(pooled)}`,
    `DATABASE_AUTH_URL=${JSON.stringify(pooled)}`,
  ].join("\n") + "\n",
);
console.log("ALIASES_WRITTEN");
console.log(
  [
    "VERCEL_MUST_SET:",
    "  DATABASE_URL (pooled)",
    "  DATABASE_ADMIN_URL (unpooled / worker)",
    "  DATABASE_AUTH_URL",
    "  MARKETING_DATABASE_URL",
    "  DATABASE_BILLING_URL",
    "  DATABASE_DISPLAY_URL",
    "  DATABASE_ALLIANCE_BOARD_URL",
    "  DATABASE_CAD_RELAY_URL",
  ].join("\n"),
);
