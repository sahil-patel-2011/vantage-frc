/**
 * Postgres host detection. Vantage tenancy is org RLS (`SET LOCAL app.user_id` /
 * `app.org_id`), not Supabase Auth and not the Supabase Data API.
 */

export type PostgresHostKind = "neon" | "supabase" | "local" | "generic";

export function connectionHost(connectionString: string): string {
  try {
    const normalized = connectionString.replace(/^postgres(ql)?:/i, "http:");
    return new URL(normalized).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function postgresHostKind(connectionString: string): PostgresHostKind {
  const host = connectionHost(connectionString);
  if (!host || host === "localhost" || host === "127.0.0.1") return "local";
  if (host.includes("neon.tech") || host.endsWith(".neon.build")) return "neon";
  if (
    host.includes("supabase.co") ||
    host.includes("supabase.com") ||
    host.includes("pooler.supabase")
  ) {
    return "supabase";
  }
  return "generic";
}

/**
 * Use node-postgres for every host except neon.tech, which keeps the Neon
 * serverless driver unless DATABASE_DRIVER=pg.
 *
 * `local` belongs on node-postgres for the same reason `supabase` and `generic`
 * do: the Neon driver talks WebSocket to a Neon endpoint, so pointing it at a
 * plain Postgres (a self-hosted instance, or the local one the RLS integration
 * tests and a from-zero migration replay run against) fails every query before
 * it reaches the server — the connection error surfaces as an opaque
 * `ErrorEvent` cause, never as SQL in the Postgres log. `sslOptionForUrl`
 * already special-cases `local`; this is the other half of that support.
 */
export function shouldUseNodePostgres(connectionString: string): boolean {
  const forced = (process.env.DATABASE_DRIVER ?? "").trim().toLowerCase();
  if (forced === "pg" || forced === "node-postgres") return true;
  if (forced === "neon") return false;
  return postgresHostKind(connectionString) !== "neon";
}

/**
 * A self-hosted Postgres (a team NAS) usually has its own certificate authority rather than a
 * public one. DATABASE_SSL_CA holds that CA's PEM (the text, or base64 of it, so it fits in one
 * env var): the connection stays encrypted AND verified, against that CA instead of the public
 * roots. Verification is never switched off.
 */
export function databaseSslCa(raw = process.env.DATABASE_SSL_CA): string | null {
  const value = raw?.trim();
  if (!value || value === "[SENSITIVE]") return null;
  if (value.includes("-----BEGIN CERTIFICATE-----")) return value.replace(/\\n/g, "\n");
  try {
    const decoded = Buffer.from(value, "base64").toString("utf8");
    return decoded.includes("-----BEGIN CERTIFICATE-----") ? decoded : null;
  } catch {
    return null;
  }
}

export function sslOptionForUrl(connectionString: string): boolean | { rejectUnauthorized: boolean; ca?: string } {
  if (postgresHostKind(connectionString) === "local") return false;
  if (/(^|[?&])sslmode=disable\b/i.test(connectionString)) return false;
  const ca = databaseSslCa();
  return ca ? { rejectUnauthorized: true, ca } : { rejectUnauthorized: true };
}

/**
 * node-postgres lets `sslmode` / `sslrootcert` in the URL replace the `ssl` object, and
 * `sslmode=require` becomes `{}`: verification against the public roots, the NAS's own CA dropped,
 * every connection refused. With DATABASE_SSL_CA set, the TLS settings come from the object alone.
 */
export function connectionStringForSsl(connectionString: string): string {
  if (!databaseSslCa()) return connectionString;
  if (postgresHostKind(connectionString) === "local") return connectionString;
  if (/(^|[?&])sslmode=disable\b/i.test(connectionString)) return connectionString;
  try {
    const url = new URL(connectionString);
    for (const key of ["sslmode", "sslrootcert", "sslcert", "sslkey", "ssl", "uselibpqcompat"]) url.searchParams.delete(key);
    return url.toString();
  } catch {
    return connectionString;
  }
}

export function firstConfiguredEnv(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value && value !== "[SENSITIVE]") return value;
  }
  return "";
}

/** Vercel/Supabase integration injects POSTGRES_URL; Vantage prefers DATABASE_*. */
const APP_DATABASE_ENVS = ["DATABASE_URL", "POSTGRES_URL"] as const;
const AUTH_DATABASE_ENVS = ["DATABASE_AUTH_URL", "DATABASE_URL", "POSTGRES_URL"] as const;
const ADMIN_DATABASE_ENVS = [
  "DATABASE_ADMIN_URL",
  "DATABASE_URL_UNPOOLED",
  "POSTGRES_URL_NON_POOLING",
  "DATABASE_URL",
  "POSTGRES_URL",
] as const;

export function resolveAppDatabaseUrl(): string {
  return firstConfiguredEnv(...APP_DATABASE_ENVS) || "postgresql://vantage:local@localhost:5432/vantage";
}

export function resolveAuthDatabaseUrl(): string {
  return firstConfiguredEnv(...AUTH_DATABASE_ENVS) || "postgresql://vantage_auth:local@localhost:5432/vantage";
}

export function resolveAdminDatabaseUrl(): string {
  return firstConfiguredEnv(...ADMIN_DATABASE_ENVS) || "postgresql://vantage_admin:local@localhost:5432/vantage";
}

export function resolveBillingDatabaseUrl(): string {
  return (
    firstConfiguredEnv("DATABASE_BILLING_URL", "DATABASE_URL", "POSTGRES_URL") ||
    "postgresql://vantage_billing:local@localhost:5432/vantage"
  );
}

export function resolveDisplayDatabaseUrl(): string {
  return (
    firstConfiguredEnv("DATABASE_DISPLAY_URL", "DATABASE_URL", "POSTGRES_URL") ||
    "postgresql://vantage_display:local@localhost:5432/vantage"
  );
}

export function resolveMarketingDatabaseUrl(): string {
  return firstConfiguredEnv("MARKETING_DATABASE_URL", "DATABASE_URL", "POSTGRES_URL");
}

export function isConfiguredPostgresUrl(): boolean {
  return Boolean(firstConfiguredEnv("DATABASE_AUTH_URL", "DATABASE_URL", "DATABASE_ADMIN_URL", "POSTGRES_URL"));
}

export function postgresUsername(connectionString: string): string {
  try {
    const normalized = connectionString.replace(/^postgres(ql)?:/i, "http:");
    return decodeURIComponent(new URL(normalized).username);
  } catch {
    return "";
  }
}

/** Default Supabase URIs use `postgres` / `postgres.PROJECTREF` until 00_roles.sql is applied. */
export function postgresUsernameLooksLikeSuperuser(connectionString: string): boolean {
  const user = postgresUsername(connectionString);
  return user === "postgres" || user.startsWith("postgres.");
}

export class UnsafePostgresUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafePostgresUrlError";
  }
}

/**
 * Reject Data API keys / REST URLs pasted into DATABASE_*. Do not reject the
 * `postgres` username — that is the pooler default until vantage_app exists.
 */
export function assertSafePostgresUrl(connectionString: string): void {
  const value = connectionString.trim();
  if (!value) {
    throw new UnsafePostgresUrlError("Postgres URL is empty.");
  }
  if (/^eyJ[A-Za-z0-9_-]+\./.test(value)) {
    throw new UnsafePostgresUrlError(
      "Value looks like a JWT (anon/service_role). Use the Postgres connection string, not a Data API key.",
    );
  }
  if (/^(sb_secret_|sb_publishable_|sbp_)/i.test(value)) {
    throw new UnsafePostgresUrlError(
      "Value looks like a Supabase API key (sb_secret_/sb_publishable_). Use the Postgres connection string, not a Data API key.",
    );
  }
  if (!/^postgres(ql)?:\/\//i.test(value)) {
    throw new UnsafePostgresUrlError(
      "Postgres URL must start with postgres:// or postgresql://. Do not use the Supabase REST URL or API keys.",
    );
  }
  if (
    /[?&]apikey=/i.test(value) ||
    (/service_role/i.test(value) && /supabase/i.test(value) && !/@/.test(value))
  ) {
    throw new UnsafePostgresUrlError("Value looks like a Supabase API key, not a Postgres URI.");
  }
}

/**
 * Supabase's pooler answers on one host in two modes. Session mode (port 5432) gives every client
 * its own server connection, capped at the project's pool size (15 on a small project): a page
 * that loads a dozen API routes at once, across warm serverless instances, ran out and every
 * extra request failed with "max clients reached in session mode". Transaction mode (port 6543)
 * lends a server connection for one transaction at a time, which is all a request needs: withRls
 * sets the tenant with SET LOCAL inside its own BEGIN/COMMIT, and no request query uses a named
 * prepared statement.
 *
 * Request pools move to transaction mode. A pool that holds session state between statements
 * (the provisioning workflow's session advisory locks) asks for `session`. DATABASE_POOL_MODE=session
 * turns the switch off everywhere. Only the Supabase pooler host on its session port is touched:
 * a direct db.<ref>.supabase.co connection, Neon, a NAS or localhost keep their URL.
 */
export const SUPABASE_SESSION_PORT = "5432";
export const SUPABASE_TRANSACTION_PORT = "6543";

export function pooledConnectionString(connectionString: string, mode: "transaction" | "session" = "transaction"): string {
  if (mode === "session") return connectionString;
  if ((process.env.DATABASE_POOL_MODE ?? "").trim().toLowerCase() === "session") return connectionString;
  if (!connectionHost(connectionString).endsWith("pooler.supabase.com")) return connectionString;
  try {
    const url = new URL(connectionString);
    if ((url.port || SUPABASE_SESSION_PORT) !== SUPABASE_SESSION_PORT) return connectionString;
    url.port = SUPABASE_TRANSACTION_PORT;
    return url.toString();
  } catch {
    return connectionString;
  }
}

export function poolLimitsForUrl(connectionString: string): {
  max: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis?: number;
} {
  if (postgresHostKind(connectionString) === "supabase") {
    return { max: 3, idleTimeoutMillis: 10_000 };
  }
  // Default local URLs point at localhost:5432. Playwright CI has no Postgres,
  // and node-postgres's default connectionTimeoutMillis of 0 waits forever on
  // some IPv6 localhost paths. Fail fast so a missing DB cannot hang a route.
  if (postgresHostKind(connectionString) === "local") {
    return { max: 8, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 3_000 };
  }
  // A self-hosted server (a team NAS) has no pooler in front of it and a default
  // max_connections of 100, shared by every warm serverless instance and every pool in it,
  // so each pool stays small and gives idle sockets back quickly. And when the NAS is off
  // or its connection drops, a request fails in seconds with the setup state instead of
  // waiting out the whole function timeout.
  if (postgresHostKind(connectionString) === "generic") {
    return { max: 4, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 10_000 };
  }
  return { max: 8, idleTimeoutMillis: 30_000 };
}
