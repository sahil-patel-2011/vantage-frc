/**
 * Neon (or any Postgres host) setup preflight for a Vantage clone.
 *
 *   node scripts/neon-preflight.mjs            # shape + live SELECT 1
 *   node scripts/neon-preflight.mjs --env-only # shape/host only, no TCP
 *   npm run db:neon-preflight
 *
 * Prints one PASS/FAIL/WARN/INFO/SKIP line per check. Never echoes passwords,
 * full connection strings, or key material. Exit code 1 when any check FAILs.
 *
 * Companion: docs/NEON.md.
 */
import pg from "pg";
import { readFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";

const MIGRATIONS_DIR = "packages/db/migrations";
const EXPECTED_ROLES = ["vantage_app", "vantage_worker"];
const DEFAULT_MIN_PG_MAJOR = 16;

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

function loadEnvFile(path) {
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

export function describeUrl(connectionString) {
  const u = parseUrl(connectionString);
  if (!u) return "<unparseable URL>";
  const user = u.username ? decodeURIComponent(u.username) : "<no user>";
  return `${u.hostname}:${u.port || "5432"} as ${user}`;
}

export function hostKind(connectionString) {
  const host = (parseUrl(connectionString)?.hostname ?? "").toLowerCase();
  if (!host || host === "localhost" || host === "127.0.0.1") return "local";
  if (host.includes("neon.tech") || host.endsWith(".neon.build")) return "neon";
  if (host.includes("supabase.co") || host.includes("supabase.com") || host.includes("pooler.supabase")) {
    return "supabase";
  }
  return "generic";
}

export function neonPooling(connectionString) {
  const host = (parseUrl(connectionString)?.hostname ?? "").toLowerCase();
  if (!host) return "unknown";
  if (host.includes("-pooler") || host.includes("pooler")) return "pooled";
  return "direct";
}

export function urlShapeProblem(value) {
  const v = String(value ?? "").trim();
  if (!v) return "not set";
  if (/^eyJ[A-Za-z0-9_-]+\./.test(v)) {
    return "looks like a JWT — use the Postgres connection string";
  }
  if (/^(sb_secret_|sb_publishable_|sbp_)/i.test(v)) {
    return "looks like a Supabase API key — use the Postgres connection string";
  }
  if (!/^postgres(ql)?:\/\//i.test(v)) {
    return "must start with postgres:// or postgresql://";
  }
  if (/[?&]apikey=/i.test(v)) return "contains an apikey= parameter";
  return null;
}

export function resolveNeonUrls(env) {
  const pick = (...names) => {
    for (const name of names) {
      const value = String(env[name] ?? "").trim();
      if (value && value !== "[SENSITIVE]") return value;
    }
    return "";
  };
  return {
    DATABASE_URL: pick("DATABASE_URL", "POSTGRES_URL"),
    DATABASE_AUTH_URL: pick("DATABASE_AUTH_URL", "DATABASE_URL", "POSTGRES_URL"),
    DATABASE_ADMIN_URL: pick(
      "DATABASE_ADMIN_URL",
      "DATABASE_URL_UNPOOLED",
      "POSTGRES_URL_NON_POOLING",
    ),
    MARKETING_DATABASE_URL: pick("MARKETING_DATABASE_URL"),
  };
}

/**
 * @typedef {{ status: "PASS" | "FAIL" | "WARN" | "INFO" | "SKIP"; name: string; detail: string }} NeonCheckRow
 */

export function checkNeonEnvShape(env) {
  /** @type {NeonCheckRow[]} */
  const rows = [];
  const urls = resolveNeonUrls(env);

  function push(status, name, detail = "") {
    rows.push({ status, name, detail });
  }

  for (const key of ["DATABASE_URL", "DATABASE_AUTH_URL", "DATABASE_ADMIN_URL"]) {
    const value = urls[key];
    const problem = urlShapeProblem(value);
    if (!value) {
      push("FAIL", `${key} configured`, "not set");
      continue;
    }
    if (problem) {
      push("FAIL", `${key} shape`, problem);
      continue;
    }
    push("PASS", `${key} shape`, `${hostKind(value)} ${neonPooling(value)} ${describeUrl(value)}`);
  }

  if (!urls.MARKETING_DATABASE_URL) {
    push("WARN", "MARKETING_DATABASE_URL", "unset — waitlist uses the in-memory dev store");
  } else {
    const problem = urlShapeProblem(urls.MARKETING_DATABASE_URL);
    if (problem) push("FAIL", "MARKETING_DATABASE_URL shape", problem);
    else push("PASS", "MARKETING_DATABASE_URL shape", describeUrl(urls.MARKETING_DATABASE_URL));
  }

  const appKind = urls.DATABASE_URL ? hostKind(urls.DATABASE_URL) : "";
  if (appKind === "neon") {
    push("PASS", "host", "DATABASE_URL is a Neon hostname (docs/NEON.md)");
  } else if (appKind === "local") {
    push("INFO", "host", "local Postgres — same migrations; Neon serverless driver is not used");
  } else if (appKind === "supabase") {
    push(
      "WARN",
      "host",
      "DATABASE_URL is a Supabase hostname. Product Postgres stays Neon unless you are following docs/SUPABASE_CUTOVER.md",
    );
  } else if (urls.DATABASE_URL) {
    push("INFO", "host", `${appKind} Postgres — freely hostable; driver is node-postgres`);
  }

  if (urls.DATABASE_URL && neonPooling(urls.DATABASE_URL) === "direct" && appKind === "neon") {
    push("INFO", "DATABASE_URL pooling", "direct Neon host; pooled (-pooler) is preferred for requests");
  }
  if (urls.DATABASE_ADMIN_URL && neonPooling(urls.DATABASE_ADMIN_URL) === "pooled") {
    push("WARN", "DATABASE_ADMIN_URL pooling", "pooler hostname — migrations want the direct / unpooled URL");
  } else if (urls.DATABASE_ADMIN_URL && urlShapeProblem(urls.DATABASE_ADMIN_URL) === null) {
    push("PASS", "DATABASE_ADMIN_URL pooling", `${neonPooling(urls.DATABASE_ADMIN_URL)} — migrate/worker path`);
  }

  if (
    urls.DATABASE_URL &&
    urls.DATABASE_ADMIN_URL &&
    urls.DATABASE_URL === urls.DATABASE_ADMIN_URL
  ) {
    push(
      "WARN",
      "pooled vs direct",
      "DATABASE_URL and DATABASE_ADMIN_URL are identical — split them when Neon shows both strings",
    );
  }

  return { rows, urls };
}

function loadMergedEnv() {
  return {
    ...loadEnvFile(".env.local"),
    ...loadEnvFile(".env.production.local"),
    ...loadEnvFile(".env.migrate.local"),
    ...process.env,
  };
}

function secretFragmentsFrom(urls) {
  const fragments = [];
  for (const value of Object.values(urls)) {
    if (!value) continue;
    fragments.push(value);
    const u = parseUrl(value);
    if (u?.password) {
      fragments.push(u.password);
      try {
        fragments.push(decodeURIComponent(u.password));
      } catch {
        // ignore malformed percent-encoding
      }
    }
  }
  return fragments.filter((fragment) => fragment && fragment.length >= 4);
}

export function scrub(text, fragments) {
  let out = String(text ?? "");
  for (const fragment of fragments) {
    out = out.split(fragment).join("<redacted>");
  }
  return out;
}

async function withClient(connectionString, work) {
  const client = new pg.Client({
    connectionString,
    ssl: hostKind(connectionString) === "local" ? false : { rejectUnauthorized: true },
    connectionTimeoutMillis: 15_000,
  });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end().catch(() => {});
  }
}

export async function runNeonPreflight(env, { connect = true } = {}) {
  const { rows, urls } = checkNeonEnvShape(env);
  const fragments = secretFragmentsFrom(urls);
  let failures = rows.filter((row) => row.status === "FAIL").length;

  function report(status, name, detail = "") {
    if (status === "FAIL") failures += 1;
    rows.push({ status, name, detail });
  }

  if (!connect) {
    return { rows, urls, failures, fragments };
  }

  const inspect =
    urls.DATABASE_ADMIN_URL && urlShapeProblem(urls.DATABASE_ADMIN_URL) === null
      ? urls.DATABASE_ADMIN_URL
      : urls.DATABASE_URL && urlShapeProblem(urls.DATABASE_URL) === null
        ? urls.DATABASE_URL
        : "";

  if (!inspect) {
    report("SKIP", "connectivity", "no reachable database URL");
    return { rows, urls, failures, fragments };
  }

  try {
    await withClient(inspect, (client) => client.query("SELECT 1"));
    report("PASS", "connectivity", describeUrl(inspect));
  } catch (error) {
    report("FAIL", "connectivity", error instanceof Error ? error.message : String(error));
    return { rows, urls, failures, fragments };
  }

  try {
    const minMajor = Number(env.PREFLIGHT_MIN_PG_MAJOR) || DEFAULT_MIN_PG_MAJOR;
    const { rows: versionRows } = await withClient(inspect, (c) =>
      c.query("SELECT current_setting('server_version') AS v"),
    );
    const version = versionRows[0]?.v ?? "";
    const major = Number(String(version).split(".")[0]);
    if (Number.isFinite(major) && major >= minMajor) {
      report("PASS", "server version", `${version} (>= required major ${minMajor})`);
    } else {
      report("FAIL", "server version", `${version} < required major ${minMajor}`);
    }
  } catch (error) {
    report("FAIL", "server version", error instanceof Error ? error.message : String(error));
  }

  try {
    const { rows: extRows } = await withClient(inspect, (c) =>
      c.query("SELECT extname FROM pg_extension WHERE extname = 'pgcrypto'"),
    );
    if (extRows.length) report("PASS", "extension pgcrypto", "installed");
    else {
      report(
        "WARN",
        "extension pgcrypto",
        "not installed yet — 0000_foundation.sql runs CREATE EXTENSION IF NOT EXISTS",
      );
    }
  } catch (error) {
    report("FAIL", "extensions", error instanceof Error ? error.message : String(error));
  }

  try {
    const { rows: roleRows } = await withClient(inspect, (c) =>
      c.query(
        "SELECT rolname, rolcanlogin, rolbypassrls FROM pg_roles WHERE rolname = ANY($1::text[])",
        [EXPECTED_ROLES],
      ),
    );
    const byName = new Map(roleRows.map((r) => [r.rolname, r]));
    for (const role of EXPECTED_ROLES) {
      const row = byName.get(role);
      if (!row) {
        report("WARN", `role ${role}`, "missing — run npm run db:migrate as a role that can CREATE ROLE");
        continue;
      }
      report("PASS", `role ${role}`, `login=${row.rolcanlogin} bypassrls=${row.rolbypassrls}`);
    }
  } catch (error) {
    report("FAIL", "roles", error instanceof Error ? error.message : String(error));
  }

  try {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((name) => name.endsWith(".sql"))
      .sort();
    const ledgerExists = await withClient(inspect, (c) =>
      c.query("SELECT to_regclass('public.schema_migrations') IS NOT NULL AS present"),
    );
    if (!ledgerExists.rows[0]?.present) {
      report(
        "WARN",
        "migration ledger",
        `schema_migrations absent — 0 applied, ${files.length} pending (run npm run db:migrate)`,
      );
    } else {
      const { rows: appliedRows } = await withClient(inspect, (c) =>
        c.query("SELECT id FROM schema_migrations"),
      );
      const applied = new Set(appliedRows.map((r) => r.id));
      const pending = files.filter((f) => !applied.has(f));
      if (pending.length === 0) {
        report("PASS", "migration ledger", `${applied.size} applied, 0 pending (local files: ${files.length})`);
      } else {
        const preview = pending.slice(0, 3).join(", ") + (pending.length > 3 ? ", …" : "");
        report("WARN", "migration ledger", `${applied.size} applied, ${pending.length} pending (next: ${preview})`);
      }
    }
  } catch (error) {
    report("FAIL", "migration ledger", error instanceof Error ? error.message : String(error));
  }

  return { rows, urls, failures, fragments };
}

export function formatRows(rows, fragments) {
  return rows.map((row) => {
    const line = row.detail ? `${row.status.padEnd(4)} ${row.name} — ${row.detail}` : `${row.status.padEnd(4)} ${row.name}`;
    return scrub(line, fragments);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const connect = !process.argv.includes("--env-only");
  const env = loadMergedEnv();
  const result = await runNeonPreflight(env, { connect });
  console.log("Neon preflight (secret-safe; see docs/NEON.md)");
  console.log("");
  for (const line of formatRows(result.rows, result.fragments)) console.log(line);
  console.log("");
  if (result.failures > 0) {
    console.log(`RESULT: ${result.failures} check(s) FAILED — see docs/NEON.md.`);
    process.exit(1);
  }
  console.log("RESULT: all hard checks passed (review any WARN lines).");
}
