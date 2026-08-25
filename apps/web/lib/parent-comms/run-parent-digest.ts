import { createSqlPool } from "@vantage/db/pool";
import { firstConfiguredEnv } from "@vantage/db/postgres-url";
import type { Pool, PoolClient } from "@neondatabase/serverless";
import { resolveMeteredUser, sendParentDigestForOrg } from "./send-digest";

/**
 * Weekly parent digest worker (see /api/cron/parent-digest).
 *
 * Worker-only: runs on the admin connection (vantage_worker), mirroring
 * run-sponsor-reminders.ts — never from request paths. It enumerates only orgs
 * that actually have active, opted-in parent contacts; per org it builds the
 * next-7-days digest and hands delivery to the shared send core, which:
 *   - sends NOTHING (and logs nothing) on an empty week;
 *   - skips contacts already logged for this period, so re-runs never double-send;
 *   - translates per contact preferred_language through meteredAI
 *     (feature=parent-digest-translate) and ships English with an explicit
 *     note when translation is unavailable;
 *   - records status='setup_required' for every contact when email delivery
 *     is not configured — an unconfigured deploy is never a hard failure.
 */

export type ParentDigestRunSummary = {
  orgsScanned: number;
  digestsBuilt: number;
  emailsSent: number;
  skipped: number;
  failed: number;
  setupRequired: number;
  errors: string[];
};

const MAX_ORGS_PER_RUN = 500;

function workerPool(): Pool {
  const connectionString = firstConfiguredEnv(
    "DATABASE_ADMIN_URL",
    "DATABASE_URL_UNPOOLED",
    "POSTGRES_URL_NON_POOLING",
    "DATABASE_URL",
    "POSTGRES_URL",
  );
  if (!connectionString) {
    throw new Error("DATABASE_ADMIN_URL or DATABASE_URL is required for the parent digest cron");
  }
  return createSqlPool(connectionString);
}

type DigestOrg = { orgId: string; orgName: string; teamNumber: number | null };

/** Only orgs with at least one active, opted-in parent contact. */
async function listOrgsWithContacts(
  client: PoolClient,
  orgId?: string,
): Promise<DigestOrg[]> {
  const result = await client.query<DigestOrg>(
    `SELECT o.id AS "orgId", o.name AS "orgName", o.team_number AS "teamNumber"
     FROM organizations o
     WHERE COALESCE(o.is_demo, false) = false
       AND ($1::uuid IS NULL OR o.id = $1::uuid)
       AND EXISTS (
         SELECT 1 FROM parent_contacts pc
         WHERE pc.org_id = o.id AND pc.active = true AND pc.digest_opt_in = true
       )
     ORDER BY o.id
     LIMIT ${MAX_ORGS_PER_RUN}`,
    [orgId ?? null],
  );
  return result.rows;
}

/** Weekly worker: one honest digest per opted-in parent contact, only on non-empty weeks. */
export async function runParentDigest(
  options: { orgId?: string; now?: Date } = {},
): Promise<ParentDigestRunSummary> {
  const now = options.now ?? new Date();
  const summary: ParentDigestRunSummary = {
    orgsScanned: 0,
    digestsBuilt: 0,
    emailsSent: 0,
    skipped: 0,
    failed: 0,
    setupRequired: 0,
    errors: [],
  };

  const pool = workerPool();
  const client = await pool.connect();
  try {
    const orgs = await listOrgsWithContacts(client, options.orgId);
    summary.orgsScanned = orgs.length;

    for (const org of orgs) {
      try {
        const meteredUserId = await resolveMeteredUser(client, org.orgId);
        const orgSummary = await sendParentDigestForOrg(client, {
          orgId: org.orgId,
          orgName: org.orgName,
          teamNumber: org.teamNumber,
          now,
          meteredUserId,
          transactionalAi: true,
          force: false,
        });
        if (orgSummary.digestBuilt) summary.digestsBuilt += 1;
        summary.emailsSent += orgSummary.sent;
        summary.skipped += orgSummary.skipped;
        summary.failed += orgSummary.failed;
        summary.setupRequired += orgSummary.setupRequired;
      } catch (error) {
        // Leave a failed transaction (if any) unwound before the next org.
        await client.query("ROLLBACK").catch(() => {});
        summary.errors.push(
          `${org.orgId}: ${error instanceof Error ? error.message : "parent digest failed"}`,
        );
      }
    }
    return summary;
  } finally {
    client.release();
    await pool.end();
  }
}
