/**
 * Map Neon / Vercel Postgres connection strings into the role-specific env
 * aliases Vantage expects.
 *
 *   node scripts/map-neon-env.mjs            # write .env.migrate.local (default)
 *   node scripts/map-neon-env.mjs --print     # secret-safe host/user lines, no write
 *   npm run db:map-neon
 *
 * `--vercel` also calls `vercel env add` for Production. That is opt-in and
 * requires NEON_VERCEL_CONFIRM=I_UNDERSTAND. Contributors should not need it.
 *
 * Source (Neon dashboard or Vercel Neon integration):
 *   DATABASE_URL / POSTGRES_URL              → pooled (PgBouncer / -pooler)
 *   DATABASE_URL_UNPOOLED / POSTGRES_URL_NON_POOLING → direct / unpooled
 *
 * Writes gitignored `.env.migrate.local` for `scripts/run-migrations.mjs`.
 * Never commit real connection strings. See docs/NEON.md.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const DEFAULT_ENV_FILES = [".env.production.local", ".env.local", ".env.migrate.local"];

export const ALIAS_KEYS = [
  "DATABASE_AUTH_URL",
  "DATABASE_ADMIN_URL",
  "MARKETING_DATABASE_URL",
  "DATABASE_BILLING_URL",
  "DATABASE_DISPLAY_URL",
  "DATABASE_ALLIANCE_BOARD_URL",
  "DATABASE_CAD_RELAY_URL",
];

export function parseEnvFile(text) {
  const out = {};
  for (const line of String(text ?? "").split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    const name = line.slice(0, i).trim();
    let value = line.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[name] = value;
  }
  return out;
}

export function loadEnvFile(path) {
  try {
    return parseEnvFile(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

export function parseUrl(connectionString) {
  try {
    return new URL(String(connectionString).replace(/^postgres(ql)?:/i, "http:"));
  } catch {
    return null;
  }
}

export function neonHostKind(connectionString) {
  const host = (parseUrl(connectionString)?.hostname ?? "").toLowerCase();
  if (!host || host === "localhost" || host === "127.0.0.1") return "local";
  if (host.includes("neon.tech") || host.endsWith(".neon.build")) return "neon";
  if (host.includes("supabase.co") || host.includes("supabase.com") || host.includes("pooler.supabase")) {
    return "supabase";
  }
  return "generic";
}

/** Neon pooled endpoints use a `-pooler` hostname. Direct endpoints do not. */
export function neonPooling(connectionString) {
  const host = (parseUrl(connectionString)?.hostname ?? "").toLowerCase();
  if (!host) return "unknown";
  if (host.includes("-pooler") || host.includes("pooler")) return "pooled";
  return "direct";
}

export function describeUrl(connectionString) {
  const u = parseUrl(connectionString);
  if (!u) return "<unparseable URL>";
  const user = u.username ? decodeURIComponent(u.username) : "<no user>";
  return `${u.hostname}:${u.port || "5432"} as ${user}`;
}

export function looksLikeUnsafePostgresValue(value) {
  const v = String(value ?? "").trim();
  if (!v) return "empty";
  if (/^eyJ[A-Za-z0-9_-]+\./.test(v)) return "jwt";
  if (/^(sb_secret_|sb_publishable_|sbp_)/i.test(v)) return "supabase-api-key";
  if (!/^postgres(ql)?:\/\//i.test(v)) return "not-postgres-uri";
  if (/[?&]apikey=/i.test(v)) return "apikey-param";
  return null;
}

export function mapNeonAliases(env) {
  const pooled = String(env.DATABASE_URL || env.POSTGRES_URL || "").trim();
  const unpooled = String(
    env.DATABASE_ADMIN_URL || env.DATABASE_URL_UNPOOLED || env.POSTGRES_URL_NON_POOLING || pooled,
  ).trim();
  const errors = [];
  const warnings = [];
  if (!pooled) errors.push("NO_DATABASE_URL");
  const pooledUnsafe = pooled ? looksLikeUnsafePostgresValue(pooled) : null;
  const unpooledUnsafe = unpooled ? looksLikeUnsafePostgresValue(unpooled) : null;
  if (pooledUnsafe) errors.push(`DATABASE_URL_${pooledUnsafe}`);
  if (unpooled && unpooledUnsafe) errors.push(`DATABASE_ADMIN_URL_${unpooledUnsafe}`);

  if (pooled && neonPooling(pooled) === "direct" && neonHostKind(pooled) === "neon") {
    warnings.push("DATABASE_URL looks like a Neon direct host (no -pooler); pooled is preferred for requests");
  }
  if (unpooled && neonPooling(unpooled) === "pooled" && neonHostKind(unpooled) === "neon") {
    warnings.push("DATABASE_ADMIN_URL looks like a Neon pooler host; migrations want the direct URL");
  }
  if (pooled && unpooled && pooled === unpooled) {
    warnings.push("pooled and direct URLs are identical — split them when Neon shows both strings");
  }

  const aliases = {
    DATABASE_URL: pooled,
    DATABASE_AUTH_URL: String(env.DATABASE_AUTH_URL || pooled).trim(),
    DATABASE_ADMIN_URL: unpooled,
    MARKETING_DATABASE_URL: String(env.MARKETING_DATABASE_URL || pooled).trim(),
    DATABASE_BILLING_URL: String(env.DATABASE_BILLING_URL || pooled).trim(),
    DATABASE_DISPLAY_URL: String(env.DATABASE_DISPLAY_URL || pooled).trim(),
    DATABASE_ALLIANCE_BOARD_URL: String(env.DATABASE_ALLIANCE_BOARD_URL || pooled).trim(),
    DATABASE_CAD_RELAY_URL: String(env.DATABASE_CAD_RELAY_URL || pooled).trim(),
  };

  return { pooled, unpooled, aliases, errors, warnings };
}

export function migrateFileContents(mapped) {
  return (
    [
      `DATABASE_ADMIN_URL=${JSON.stringify(mapped.aliases.DATABASE_ADMIN_URL)}`,
      `DATABASE_URL=${JSON.stringify(mapped.aliases.DATABASE_URL)}`,
      `DATABASE_AUTH_URL=${JSON.stringify(mapped.aliases.DATABASE_AUTH_URL)}`,
    ].join("\n") + "\n"
  );
}

export function parseArgs(argv) {
  const args = argv.slice();
  return {
    print: args.includes("--print"),
    vercel: args.includes("--vercel"),
    local: args.includes("--local") || !args.includes("--vercel"),
  };
}

function writeVercelAliases(aliases) {
  if (process.env.NEON_VERCEL_CONFIRM !== "I_UNDERSTAND") {
    console.error(
      "Refusing vercel env add. When you are ready to write Production, set NEON_VERCEL_CONFIRM=I_UNDERSTAND and rerun with --vercel.",
    );
    process.exit(1);
  }
  for (const key of ALIAS_KEYS) {
    const value = aliases[key];
    const result = spawnSync("vercel", ["env", "add", key, "production", "--yes"], {
      input: `${value}\n`,
      encoding: "utf8",
    });
    const text = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    const ok = result.status === 0 || /already exists|Added/i.test(text);
    console.log(key, ok ? "OK" : "FAIL");
    if (!ok) console.log(text.split(/\r?\n/).slice(0, 6).join(" | "));
  }
}

export function runMapNeonEnv(env, argv, io = {}) {
  const flags = parseArgs(argv);
  const mapped = mapNeonAliases(env);
  if (mapped.errors.length) {
    for (const error of mapped.errors) console.error(error);
    return { ok: false, mapped };
  }
  for (const warning of mapped.warnings) console.warn("WARN", warning);
  if (flags.print) {
    for (const [key, value] of Object.entries(mapped.aliases)) {
      console.log(key, neonPooling(value), neonHostKind(value), describeUrl(value));
    }
    return { ok: true, mapped };
  }
  const contents = migrateFileContents(mapped);
  const writeFile = io.writeFileSync ?? writeFileSync;
  writeFile(".env.migrate.local", contents);
  console.log("ALIASES_WRITTEN");
  console.log(
    [
      "LOCAL_MUST_SET:",
      "  DATABASE_URL (pooled)",
      "  DATABASE_ADMIN_URL (unpooled / worker)",
      "  DATABASE_AUTH_URL",
      "  MARKETING_DATABASE_URL",
    ].join("\n"),
  );
  if (flags.vercel) writeVercelAliases(mapped.aliases);
  return { ok: true, mapped };
}

function mergedEnv() {
  const fileEnv = {};
  for (const path of DEFAULT_ENV_FILES) {
    if (existsSync(path)) Object.assign(fileEnv, loadEnvFile(path));
  }
  return { ...fileEnv, ...process.env };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runMapNeonEnv(mergedEnv(), process.argv.slice(2));
  if (!result.ok) process.exit(1);
}
