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
 * Use node-postgres for Supabase / generic Postgres. Keep the Neon serverless
 * driver for neon.tech hosts unless DATABASE_DRIVER=pg.
 */
export function shouldUseNodePostgres(connectionString: string): boolean {
  const forced = (process.env.DATABASE_DRIVER ?? "").trim().toLowerCase();
  if (forced === "pg" || forced === "node-postgres") return true;
  if (forced === "neon") return false;
  const kind = postgresHostKind(connectionString);
  return kind === "supabase" || kind === "generic";
}

export function sslOptionForUrl(connectionString: string): boolean | { rejectUnauthorized: boolean } {
  if (postgresHostKind(connectionString) === "local") return false;
  if (/(^|[?&])sslmode=disable\b/i.test(connectionString)) return false;
  return { rejectUnauthorized: true };
}
