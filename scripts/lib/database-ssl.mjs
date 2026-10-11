// TLS for scripts that open their own node-postgres connection (migrations, the deploy schema
// gate, recovery checkpoints). Same rule as packages/db/src/postgres-url.ts: a self-hosted
// Postgres (a team NAS) with its own certificate authority sets DATABASE_SSL_CA to that CA's PEM,
// or base64 of it, and the connection is verified against it. Verification is never switched off.

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function databaseSslCa(raw) {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value || value === "[SENSITIVE]") return null;
  if (value.includes("-----BEGIN CERTIFICATE-----")) return value.replace(/\\n/g, "\n");
  const decoded = Buffer.from(value, "base64").toString("utf8");
  return decoded.includes("-----BEGIN CERTIFICATE-----") ? decoded : null;
}

/**
 * `{ connectionString, ssl }` for `new pg.Pool` / `new pg.Client`. node-postgres lets `sslmode` in
 * the URL replace the `ssl` object, which would drop the CA, so with a CA those URL params go.
 */
export function pgTlsOptions(url, env = process.env) {
  let hostname;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return { connectionString: url, ssl: { rejectUnauthorized: true } };
  }
  if (LOCAL_HOSTS.has(hostname) || /(^|[?&])sslmode=disable\b/i.test(url)) return { connectionString: url, ssl: false };
  const ca = databaseSslCa(env.DATABASE_SSL_CA);
  if (!ca) return { connectionString: url, ssl: { rejectUnauthorized: true } };
  const stripped = new URL(url);
  for (const key of ["sslmode", "sslrootcert", "sslcert", "sslkey", "ssl", "uselibpqcompat"]) stripped.searchParams.delete(key);
  return { connectionString: stripped.toString(), ssl: { rejectUnauthorized: true, ca } };
}
