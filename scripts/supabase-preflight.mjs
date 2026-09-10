/**
 * Supabase (or any Postgres host) cutover preflight.
 *
 *   node scripts/supabase-preflight.mjs
 *
 * Run AFTER entering credentials (env vars or .env.migrate.local /
 * .env.production.local / .env.local — process.env wins). Safe to dry-run
 * against the current Neon env today: every check is host-agnostic and the
 * Supabase-specific ones report INFO/SKIP on Neon.
 *
 * Prints one PASS/FAIL/WARN/SKIP line per check. Never echoes passwords,
 * full connection strings, or key material. Exit code 1 when any check FAILs.
 *
 * Companion runbook: docs/SUPABASE_CUTOVER.md (see "Connection pooling and
 * withRls" and "Roles" sections referenced below).
 */
import pg from "pg";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";

const MIGRATIONS_DIR = "packages/db/migrations";
// Update alongside docs/SUPABASE_CUTOVER.md § "Postgres version" — the Neon
// production major recorded there (17.x as of 2026-08). Override with
// PREFLIGHT_MIN_PG_MAJOR.
const DEFAULT_MIN_PG_MAJOR = 17;
// Every LOGIN/NOLOGIN role a fresh database needs before/after migrations.
// NOLOGIN roles are created by migrations 0001/0007/0009/0017/0019/0033, but
// only when the migration role may CREATE ROLE — see the doc's "Roles" section.
const EXPECTED_ROLES = [
  "vantage_app",
  "vantage_worker",
  "vantage_auth",
  "vantage_marketing",
  "vantage_billing",
  "vantage_display",
  "vantage_alliance_board",
  "vantage_pairing",
  "vantage_showcase",
];

// ---------- env loading (process.env wins; .env files fill gaps) ----------

function loadEnvFile(path) {
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

const fileEnv = {
  ...loadEnvFile(".env.local"),
  ...loadEnvFile(".env.production.local"),
  ...loadEnvFile(".env.migrate.local"),
};
function env(name) {
  const fromProcess = process.env[name]?.trim();
  if (fromProcess && fromProcess !== "[SENSITIVE]") return fromProcess;
  const fromFile = fileEnv[name]?.trim();
  if (fromFile && fromFile !== "[SENSITIVE]") return fromFile;
  return "";
}

// ---------- secret-safe URL description ----------

function parseUrl(connectionString) {
  try {
    return new URL(connectionString.replace(/^postgres(ql)?:/i, "http:"));
  } catch {
    return null;
  }
}

/** host:port as <user> — never the password, never the full URL. */
function describeUrl(connectionString) {
  const u = parseUrl(connectionString);
  if (!u) return "<unparseable URL>";
  const user = u.username ? decodeURIComponent(u.username) : "<no user>";
  return `${u.hostname}:${u.port || "5432"} as ${user}`;
}

const secretFragments = [];
function registerSecrets(connectionString) {
  const u = parseUrl(connectionString);
  if (!u) return;
  if (u.password) secretFragments.push(u.password, decodeURIComponent(u.password));
  secretFragments.push(connectionString);
}
function scrub(text) {
  let out = String(text ?? "");
  for (const fragment of secretFragments) {
    if (fragment && fragment.length >= 4) out = out.split(fragment).join("<redacted>");
  }
  return out;
}

// ---------- URL shape checks (mirrors packages/db/src/postgres-url.ts) ----------

function urlShapeProblem(value) {
  if (/^eyJ[A-Za-z0-9_-]+\./.test(value)) {
    return "looks like a JWT (anon/service_role) — use the Postgres connection string";
  }
  if (/^(sb_secret_|sb_publishable_|sbp_)/i.test(value)) {
    return "looks like a Supabase API key (sb_secret_/sb_publishable_) — use the Postgres connection string";
  }
  if (!/^postgres(ql)?:\/\//i.test(value)) {
    return "must start with postgres:// or postgresql:// (not the Supabase REST URL or an API key)";
  }
  if (/[?&]apikey=/i.test(value)) return "contains an apikey= parameter — that is a Data API key";
  return null;
}

function hostKind(connectionString) {
  const u = parseUrl(connectionString);
  const host = (u?.hostname ?? "").toLowerCase();
  if (!host || host === "localhost" || host === "127.0.0.1") return "local";
  if (host.includes("neon.tech") || host.endsWith(".neon.build")) return "neon";
  if (host.includes("supabase.co") || host.includes("supabase.com") || host.includes("pooler.supabase")) {
    return "supabase";
  }
  return "generic";
}

/** "transaction" | "session" | "direct" | null (null = not a Supabase URL). */
function supabasePoolerMode(connectionString) {
  if (hostKind(connectionString) !== "supabase") return null;
  const u = parseUrl(connectionString);
  const host = (u?.hostname ?? "").toLowerCase();
  const port = u?.port || "5432";
  const pooled = host.includes("pooler.supabase");
  if (!pooled) return "direct";
  return port === "6543" ? "transaction" : "session";
}

// ---------- reporting ----------

let failures = 0;
function report(status, name, detail = "") {
  if (status === "FAIL") failures += 1;
  const line = detail ? `${status.padEnd(4)} ${name} — ${detail}` : `${status.padEnd(4)} ${name}`;
  console.log(scrub(line));
}

// ---------- checks ----------

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

function localMigrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

async function checkConnectivity(name, url) {
  if (!url) {
    report("FAIL", `${name} configured`, "not set");
    return false;
  }
  const shapeProblem = urlShapeProblem(url);
  if (shapeProblem) {
    report("FAIL", `${name} shape`, shapeProblem);
    return false;
  }
  report("PASS", `${name} shape`, describeUrl(url));
  try {
    await withClient(url, (client) => client.query("SELECT 1"));
    report("PASS", `${name} connectivity`, describeUrl(url));
    return true;
  } catch (error) {
    report("FAIL", `${name} connectivity`, error instanceof Error ? error.message : String(error));
    return false;
  }
}

function checkPoolerMode(name, url, { isAdmin }) {
  if (!url) return;
  const mode = supabasePoolerMode(url);
  if (mode === null) {
    const kind = hostKind(url);
    report("INFO", `${name} pooling`, `${kind} host — Supabase pooler check not applicable`);
    return;
  }
  if (mode === "transaction") {
    const where = "docs/SUPABASE_CUTOVER.md § Connection pooling and withRls";
    if (isAdmin) {
      report(
        "FAIL",
        `${name} pooling`,
        `port 6543 = TRANSACTION-mode pooler. Migrations and workers need the direct/session ` +
          `connection (port 5432). ${where}`,
      );
    } else {
      report(
        "WARN",
        `${name} pooling`,
        `port 6543 = TRANSACTION-mode pooler. SET LOCAL / set_config(..., true) is only valid ` +
          `inside BEGIN…COMMIT; withRls does wrap every request in a transaction, but ANY query ` +
          `outside one silently loses tenancy state and prepared statements break. ` +
          `Prefer the SESSION-mode pooler (port 5432). ${where}`,
      );
    }
    return;
  }
  report("PASS", `${name} pooling`, `${mode} connection (port ${parseUrl(url)?.port || "5432"}) — session semantics, withRls-safe`);
}

async function checkServerVersion(url) {
  const minMajor = Number(env("PREFLIGHT_MIN_PG_MAJOR")) || DEFAULT_MIN_PG_MAJOR;
  try {
    const { rows } = await withClient(url, (c) => c.query("SELECT current_setting('server_version') AS v"));
    const version = rows[0]?.v ?? "";
    const major = Number(String(version).split(".")[0]);
    if (Number.isFinite(major) && major >= minMajor) {
      report("PASS", "server version", `${version} (>= required major ${minMajor})`);
    } else {
      report("FAIL", "server version", `${version} < required major ${minMajor} (PREFLIGHT_MIN_PG_MAJOR)`);
    }
  } catch (error) {
    report("FAIL", "server version", error instanceof Error ? error.message : String(error));
  }
}

async function checkExtensions(url) {
  // Sourced from `grep -r "CREATE EXTENSION" packages/db/migrations`.
  const required = ["pgcrypto"];
  try {
    const { rows } = await withClient(url, (c) =>
      c.query("SELECT extname FROM pg_extension WHERE extname = ANY($1::text[])", [required]),
    );
    const present = new Set(rows.map((r) => r.extname));
    for (const ext of required) {
      if (present.has(ext)) report("PASS", `extension ${ext}`, "installed");
      else {
        report(
          "WARN",
          `extension ${ext}`,
          "not installed yet — migration 0000 runs CREATE EXTENSION IF NOT EXISTS; the migration role needs permission to create it (Supabase allows pgcrypto)",
        );
      }
    }
  } catch (error) {
    report("FAIL", "extensions", error instanceof Error ? error.message : String(error));
  }
}

async function checkRoles(url) {
  try {
    const { rows } = await withClient(url, (c) =>
      c.query(
        "SELECT rolname, rolcanlogin, rolbypassrls, rolsuper FROM pg_roles WHERE rolname = ANY($1::text[])",
        [EXPECTED_ROLES],
      ),
    );
    const byName = new Map(rows.map((r) => [r.rolname, r]));
    for (const role of EXPECTED_ROLES) {
      const row = byName.get(role);
      if (!row) {
        const isLogin = role === "vantage_app" || role === "vantage_worker";
        report(
          "FAIL",
          `role ${role}`,
          isLogin
            ? "missing — run packages/db/supabase/00_roles.sql (and set a password) before migrating"
            : "missing — pre-create it NOLOGIN before `npm run db:migrate` (docs/SUPABASE_CUTOVER.md § Roles); the migration that creates it only tolerates duplicate_object, not insufficient_privilege",
        );
        continue;
      }
      report("PASS", `role ${role}`, `login=${row.rolcanlogin} bypassrls=${row.rolbypassrls}`);
    }

    // vantage_worker must be able to read every row: BYPASSRLS (Neon, where a
    // superuser ran 0001) or table ownership (Supabase, where migrations run
    // as vantage_worker itself). Owner of a table skips RLS unless FORCED.
    const worker = byName.get("vantage_worker");
    if (worker) {
      if (worker.rolbypassrls) {
        report("PASS", "vantage_worker RLS bypass", "BYPASSRLS attribute set");
      } else {
        const owner = await withClient(url, (c) =>
          c.query("SELECT tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'organizations'"),
        );
        const tableOwner = owner.rows[0]?.tableowner;
        if (!tableOwner) {
          report("SKIP", "vantage_worker RLS bypass", "organizations table not created yet (migrations pending)");
        } else if (tableOwner === "vantage_worker") {
          report("PASS", "vantage_worker RLS bypass", "no BYPASSRLS, but owns public tables (owner skips RLS)");
        } else {
          report(
            "FAIL",
            "vantage_worker RLS bypass",
            `no BYPASSRLS and tables are owned by ${tableOwner} — RLS will block every worker job. ` +
              "Run migrations as vantage_worker, or grant BYPASSRLS (docs/SUPABASE_CUTOVER.md § Roles)",
          );
        }
      }
    }

    // Data API roles must have nothing on public (migration 0432 revokes).
    const dataApi = await withClient(url, (c) =>
      c.query("SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')"),
    );
    if (dataApi.rows.length === 0) {
      report("INFO", "Supabase Data API roles", "anon/authenticated/service_role absent (Neon or non-Supabase host)");
    } else {
      const leaked = await withClient(url, (c) =>
        c.query(
          `SELECT DISTINCT grantee FROM information_schema.role_table_grants
           WHERE table_schema = 'public' AND grantee IN ('anon','authenticated')`,
        ),
      );
      if (leaked.rows.length === 0) {
        report("PASS", "Supabase Data API roles", "anon/authenticated hold no table grants on public (0432 applied)");
      } else {
        report(
          "FAIL",
          "Supabase Data API roles",
          `${leaked.rows.map((r) => r.grantee).join(", ")} still have table grants on public — apply migration 0432 and disable the Data API`,
        );
      }
    }
  } catch (error) {
    report("FAIL", "roles", error instanceof Error ? error.message : String(error));
  }
}

async function checkMigrationLedger(url) {
  let files;
  try {
    files = localMigrationFiles();
  } catch (error) {
    report("FAIL", "migration files", `cannot read ${MIGRATIONS_DIR}: ${error instanceof Error ? error.message : error}`);
    return;
  }
  try {
    const ledgerExists = await withClient(url, (c) =>
      c.query("SELECT to_regclass('public.schema_migrations') IS NOT NULL AS present"),
    );
    if (!ledgerExists.rows[0]?.present) {
      report(
        "WARN",
        "migration ledger",
        `schema_migrations table absent — 0 applied, ${files.length} pending (fresh host; run npm run db:migrate)`,
      );
      return;
    }
    const { rows } = await withClient(url, (c) => c.query("SELECT id FROM schema_migrations"));
    const applied = new Set(rows.map((r) => r.id));
    const pending = files.filter((f) => !applied.has(f));
    const unknown = [...applied].filter((id) => !files.includes(id));
    if (pending.length === 0) {
      report("PASS", "migration ledger", `${applied.size} applied, 0 pending (local files: ${files.length})`);
    } else {
      const preview = pending.slice(0, 3).join(", ") + (pending.length > 3 ? ", …" : "");
      report("WARN", "migration ledger", `${applied.size} applied, ${pending.length} pending (next: ${preview})`);
    }
    if (unknown.length > 0) {
      report("WARN", "migration ledger drift", `${unknown.length} applied ids have no local file (e.g. ${unknown[0]})`);
    }
  } catch (error) {
    report("FAIL", "migration ledger", error instanceof Error ? error.message : String(error));
  }
}

async function checkRlsSmoke(appUrl) {
  try {
    await withClient(appUrl, async (client) => {
      const who = await client.query("SELECT current_user AS u, usesuper AS super FROM pg_user WHERE usename = current_user");
      const user = who.rows[0]?.u ?? "?";
      const isSuper = Boolean(who.rows[0]?.super);
      if (user === "postgres" || user.startsWith("postgres.") || isSuper) {
        report(
          "WARN",
          "RLS smoke identity",
          `DATABASE_URL connects as ${user}${isSuper ? " (superuser)" : ""} — RLS does not bind; switch to vantage_app before go-live`,
        );
      } else {
        report("PASS", "RLS smoke identity", `connected as ${user}`);
      }

      const tableExists = await client.query("SELECT to_regclass('public.organizations') IS NOT NULL AS present");
      if (!tableExists.rows[0]?.present) {
        report("SKIP", "RLS smoke", "organizations table absent (migrations pending)");
        return;
      }
      await client.query("BEGIN");
      try {
        await client.query("SELECT set_config('app.user_id', $1, true)", [randomUUID()]);
        await client.query("SELECT set_config('app.org_id', $1, true)", [""]);
        const { rows } = await client.query("SELECT count(*)::int AS n FROM organizations");
        const n = rows[0]?.n ?? 0;
        if (n === 0) {
          report("PASS", "RLS smoke", "random app.user_id sees 0 organizations (no cross-tenant leak)");
        } else {
          report(
            "FAIL",
            "RLS smoke",
            `random app.user_id sees ${n} organizations — RLS is not filtering (role owns the table, has BYPASSRLS, or policies are missing)`,
          );
        }
      } finally {
        await client.query("ROLLBACK").catch(() => {});
      }
    });
  } catch (error) {
    report("FAIL", "RLS smoke", error instanceof Error ? error.message : String(error));
  }
}

// ---------- main ----------

const urls = {
  DATABASE_URL: env("DATABASE_URL") || env("POSTGRES_URL"),
  DATABASE_AUTH_URL: env("DATABASE_AUTH_URL") || env("DATABASE_URL") || env("POSTGRES_URL"),
  DATABASE_ADMIN_URL:
    env("DATABASE_ADMIN_URL") || env("DATABASE_URL_UNPOOLED") || env("POSTGRES_URL_NON_POOLING"),
};
for (const url of Object.values(urls)) if (url) registerSecrets(url);

console.log("Supabase cutover preflight (secret-safe; see docs/SUPABASE_CUTOVER.md)");
console.log("");

const okApp = await checkConnectivity("DATABASE_URL", urls.DATABASE_URL);
const okAuth = await checkConnectivity("DATABASE_AUTH_URL", urls.DATABASE_AUTH_URL);
const okAdmin = await checkConnectivity("DATABASE_ADMIN_URL", urls.DATABASE_ADMIN_URL);

checkPoolerMode("DATABASE_URL", urls.DATABASE_URL, { isAdmin: false });
checkPoolerMode("DATABASE_AUTH_URL", urls.DATABASE_AUTH_URL, { isAdmin: false });
checkPoolerMode("DATABASE_ADMIN_URL", urls.DATABASE_ADMIN_URL, { isAdmin: true });

const inspectUrl = okAdmin ? urls.DATABASE_ADMIN_URL : okApp ? urls.DATABASE_URL : okAuth ? urls.DATABASE_AUTH_URL : "";
if (inspectUrl) {
  await checkServerVersion(inspectUrl);
  await checkExtensions(inspectUrl);
  await checkRoles(inspectUrl);
  await checkMigrationLedger(inspectUrl);
} else {
  report("SKIP", "server checks", "no reachable database URL");
}

if (okApp) {
  await checkRlsSmoke(urls.DATABASE_URL);
} else {
  report("SKIP", "RLS smoke", "DATABASE_URL unreachable");
}

const secondaryPaid = env("SUPABASE_PAID_DATABASE_URL");
const secondaryFree = env("SUPABASE_FREE_DATABASE_URL");
if (secondaryPaid || secondaryFree) {
  if (secondaryPaid) registerSecrets(secondaryPaid);
  if (secondaryFree) registerSecrets(secondaryFree);
  report("INFO", "secondary profiles", "checking paid + free connection strings; nothing is switched over");
  if (secondaryPaid) {
    await checkConnectivity("SUPABASE_PAID_DATABASE_URL", secondaryPaid);
    checkPoolerMode("SUPABASE_PAID_DATABASE_URL", secondaryPaid, { isAdmin: false });
  } else {
    report("SKIP", "SUPABASE_PAID_DATABASE_URL", "not set — paste when the owner creates the paid project");
  }
  if (secondaryFree) {
    await checkConnectivity("SUPABASE_FREE_DATABASE_URL", secondaryFree);
    checkPoolerMode("SUPABASE_FREE_DATABASE_URL", secondaryFree, { isAdmin: false });
  } else {
    report("SKIP", "SUPABASE_FREE_DATABASE_URL", "not set — paste when the owner creates the free project");
  }
} else {
  report(
    "SKIP",
    "Supabase redundancy",
    "SUPABASE_PAID_DATABASE_URL and SUPABASE_FREE_DATABASE_URL are unset. Identity stays Better Auth + withRls. Do not put anon/service_role keys here.",
  );
}

console.log("");
if (failures > 0) {
  console.log(`RESULT: ${failures} check(s) FAILED — do not cut over. See docs/SUPABASE_CUTOVER.md.`);
  process.exit(1);
}
console.log("RESULT: all hard checks passed (review any WARN lines before cutting over).");
