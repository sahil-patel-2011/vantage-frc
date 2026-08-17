/**
 * Map Supabase Postgres URLs into Vantage role aliases.
 *
 * Source (Dashboard → Database → Connection string):
 *   DATABASE_URL            transaction pooler as vantage_app (port 6543)
 *   DATABASE_URL_UNPOOLED   direct/session as vantage_worker (port 5432)
 *
 * Writes `.env.migrate.local`. Never commit real connection strings.
 * Do not put the `service_role` secret or anon key in DATABASE_* URLs.
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

const env = { ...loadEnv(".env.production.local"), ...loadEnv(".env.local") };
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

if (process.argv.includes("--vercel")) {
  for (const [key, value] of aliases) add(key, value);
}

writeFileSync(
  ".env.migrate.local",
  [
    `DATABASE_ADMIN_URL=${JSON.stringify(unpooled)}`,
    `DATABASE_URL=${JSON.stringify(pooled)}`,
    `DATABASE_AUTH_URL=${JSON.stringify(env.DATABASE_AUTH_URL || pooled)}`,
    `DATABASE_DRIVER=pg`,
  ].join("\n") + "\n",
);
console.log("SUPABASE_ALIASES_WRITTEN");
