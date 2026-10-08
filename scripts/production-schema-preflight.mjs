import pg from "pg";
import { pathToFileURL } from "node:url";

export const REQUIRED_PRODUCTION_MIGRATIONS = [
  "0710_scouting_management_capability.sql",
  "0711_delegated_scouting_leads.sql",
  "0712_account_first_run_tour.sql",
  "0713_scouting_lead_notifications.sql",
  "0714_practice_scouting_corrections.sql",
  "0715_member_self_departure.sql",
  "0716_onshape_browser_pilot_access.sql",
];

/** Read-only deployment gate. Local/CI builds never acquire database access. */
export async function checkProductionSchema({ env = process.env, createPool = options => new pg.Pool(options) } = {}) {
  if (env.VERCEL_ENV !== "production") return { checked: false };
  const url = env.DATABASE_ADMIN_URL || env.DATABASE_URL_UNPOOLED || env.POSTGRES_URL_NON_POOLING;
  if (!url) throw new Error("Production schema check needs the configured migration connection. Apply migrations before deployment.");
  let hostname;
  try { hostname = new URL(url).hostname; }
  catch { throw new Error("Production schema check has an invalid migration connection."); }
  const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname);
  if (local && env.GITHUB_ACTIONS !== "true") throw new Error("Production schema checks cannot use a laptop database.");
  const pool = createPool({ connectionString: url, max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 10_000,
    ssl: local || /(^|[?&])sslmode=disable\b/i.test(url) ? false : { rejectUnauthorized: true } });
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN READ ONLY");
    const result = await client.query("SELECT id FROM public.schema_migrations WHERE id = ANY($1::text[])", [REQUIRED_PRODUCTION_MIGRATIONS]);
    const applied = new Set(result.rows.map(row => row.id));
    const missing = REQUIRED_PRODUCTION_MIGRATIONS.filter(id => !applied.has(id));
    if (missing.length) throw new Error(`Apply these migrations before production deployment: ${missing.join(", ")}`);
    return { checked: true, migrations: REQUIRED_PRODUCTION_MIGRATIONS.length };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Apply these migrations")) throw error;
    // Driver errors may contain hosts, credentials or database details.
    // eslint-disable-next-line preserve-caught-error -- Never retain credential-bearing driver causes in a deployment diagnostic.
    throw new Error("Production schema readiness could not be verified. Check the migration connection and apply migrations before deployment.");
  } finally {
    if (client) {
      try { await client.query("ROLLBACK"); } catch { /* A disconnected read-only transaction is already closed. */ }
      client.release();
    }
    try { await pool.end(); } catch { /* Do not replace the safe diagnostic with a driver cleanup error. */ }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await checkProductionSchema();
    console.log(result.checked ? `Production schema verified: ${result.migrations} required migrations.` : "Schema deployment check skipped outside Vercel production.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Production schema verification failed.");
    process.exitCode = 1;
  }
}
