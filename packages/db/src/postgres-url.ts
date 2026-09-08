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

export function sslOptionForUrl(connectionString: string): boolean | { rejectUnauthorized: boolean } {
  if (postgresHostKind(connectionString) === "local") return false;
  if (/(^|[?&])sslmode=disable\b/i.test(connectionString)) return false;
  return { rejectUnauthorized: true };
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

export function poolLimitsForUrl(connectionString: string): { max: number; idleTimeoutMillis: number } {
  if (postgresHostKind(connectionString) === "supabase") {
    return { max: 3, idleTimeoutMillis: 10_000 };
  }
  return { max: 8, idleTimeoutMillis: 30_000 };
}
