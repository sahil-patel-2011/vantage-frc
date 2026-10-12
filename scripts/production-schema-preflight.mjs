import pg from "pg";
import { pathToFileURL } from "node:url";
import { pgTlsOptions } from "./lib/database-ssl.mjs";

export const REQUIRED_PRODUCTION_MIGRATIONS = [
  "0710_scouting_management_capability.sql",
  "0711_delegated_scouting_leads.sql",
  "0712_account_first_run_tour.sql",
  "0713_scouting_lead_notifications.sql",
  "0714_finance_managers.sql",
  // View only = read-only: request code calls is_org_viewer() (withRls, scouting sync).
  "0715_view_only_read_only.sql",
  "0716_github_pr_reviews.sql",
  // Team lessons: /api/team-lessons reads and writes team_lessons, revisions and attempts.
  "0717_team_lessons.sql",
  // The outage console's contact list: /api/me (platform admins) and /api/admin/outage-contacts
  // call list_service_notice_recipients().
  "0718_service_notice_recipients.sql",
  // Guided-track lead sign-offs: /api/guided and /api/guided/team read guided_signoffs.
  "0719_guided_signoffs.sql",
  // Team lifecycle: /api/organizations/lifecycle and /api/account/delete call leave_team(),
  // delete_team(), team_has_live_subscription() and delete_my_account().
  "0720_team_lifecycle.sql",
  // Invites and roles: /api/teams/join calls team_code_join_retry_at(), invite acceptance calls
  // my_invite_join_context(), /api/invites/preview calls peek_replaced_invite(), suggestions call
  // suggest_team_invite(), and Team admin reads team_join_codes.join_role.
  "0721_invites_and_roles.sql",
  // Un-assign on the Assignments board: /api/scouting/coverage deletes scout_assignments rows.
  "0722_scout_assignment_unassign.sql",
  // Operations trust: /api/hours reads hour_logs.entry_source and correction columns; the
  // two-person reimbursement rule, lead-only certifications and sign-off notices live in RLS.
  "0723_operations_trust.sql",
  // Send feedback: POST /api/feedback/bug writes bug_reports.kind and /api/admin/feedback filters on it.
  "0726_feedback_kind.sql",
  // Platform admin: /api/admin/platform-admins calls platform_admin_list/add/remove/transfer();
  // AI credit gifts (/api/admin/ai-credits, /api/ai-credit, every Ask AI call via
  // ai_credit_gift_for_org / reserve / settle) and /api/admin/health (platform_job_health).
  "0727_platform_admin_credits.sql",
  // "Your apps": /api/navigation/preferences reads and writes profiles.pinned_apps (it falls back
  // to island_tabs without it, but then only a bar of exactly four can be saved).
  "0729_more_pinned_apps.sql",
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
  const pool = createPool({ ...pgTlsOptions(url, env), max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 10_000 });
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
