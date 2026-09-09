/**
 * New-member onboarding worker.
 *
 * Worker-only: runs on the admin connection (vantage_worker) from
 * /api/cron/member-onboarding, the same shape as run-performance-email.ts. It
 * never runs on a request path.
 *
 * Three things keep it from becoming a mail cannon:
 *
 *   1. The epoch. `email_feature_epochs` records when this feature switched on;
 *      only memberships created at or after it are considered. Deploying this
 *      does not send "welcome to the team" to people who joined last spring.
 *   2. The claim. One `member_onboarding_email_log` row per (member, stage),
 *      inserted BEFORE the send, so a re-run cannot repeat a stage.
 *   3. The state check. `first_week` and `settling_in` send nothing at all when
 *      the member has nothing outstanding, which is the common case.
 */

import { createSqlPool } from "@vantage/db/pool";
import { firstConfiguredEnv } from "@vantage/db/postgres-url";
import { resolveAuthBaseURL, sendMemberOnboardingEmail } from "@vantage/core";
import type { Pool, PoolClient } from "@neondatabase/serverless";
import {
  ONBOARDING_WINDOW_DAYS,
  renderOnboardingEmail,
  stageForAge,
  type OnboardingOutstanding,
  type OnboardingStage,
} from "./compute-onboarding";

export type MemberOnboardingRunSummary = {
  membersScanned: number;
  emailsSent: number;
  skippedPref: number;
  skippedNothingDue: number;
  alreadyStaged: number;
  failed: number;
  errors: string[];
};

const MAX_MEMBERS_PER_RUN = 500;
const MAX_ITEMS_LISTED = 6;

function workerPool(): Pool {
  const connectionString = firstConfiguredEnv(
    "DATABASE_ADMIN_URL",
    "DATABASE_URL_UNPOOLED",
    "POSTGRES_URL_NON_POOLING",
    "DATABASE_URL",
    "POSTGRES_URL",
  );
  if (!connectionString) {
    throw new Error("DATABASE_ADMIN_URL or DATABASE_URL is required for the member onboarding cron");
  }
  return createSqlPool(connectionString);
}

type CandidateRow = {
  orgId: string;
  orgName: string;
  teamNumber: number | null;
  userId: string;
  memberName: string | null;
  daysSinceJoin: number;
  joinedAt: string;
  profileIncomplete: boolean;
};

/**
 * Members who joined inside the window, on or after the feature's epoch.
 *
 * The epoch join is an INNER join on purpose: if the epoch row is missing the
 * query returns nobody, which is the safe direction to fail in.
 */
async function listCandidates(
  client: PoolClient,
  options: { orgId?: string; now: Date },
): Promise<CandidateRow[]> {
  const result = await client.query<CandidateRow>(
    `SELECT m.org_id AS "orgId",
            o.name AS "orgName",
            o.team_number AS "teamNumber",
            m.user_id AS "userId",
            COALESCE(NULLIF(u.name, ''), NULLIF(p.first_name, '')) AS "memberName",
            FLOOR(EXTRACT(EPOCH FROM ($2::timestamptz - m.created_at)) / 86400)::int AS "daysSinceJoin",
            m.created_at::text AS "joinedAt",
            (p.onboarding_completed_at IS NULL) AS "profileIncomplete"
       FROM memberships m
       JOIN organizations o ON o.id = m.org_id
       JOIN users u ON u.id = m.user_id
       JOIN email_feature_epochs e ON e.feature = 'member_onboarding'
       LEFT JOIN profiles p ON p.user_id = m.user_id
      WHERE COALESCE(o.is_demo, false) = false
        AND m.created_at >= e.started_at
        AND m.created_at >= $2::timestamptz - ($3::int * INTERVAL '1 day')
        AND m.created_at <= $2::timestamptz
        AND u.email IS NOT NULL
        AND btrim(u.email) <> ''
        AND ($1::uuid IS NULL OR m.org_id = $1::uuid)
      ORDER BY m.created_at
      LIMIT ${MAX_MEMBERS_PER_RUN}`,
    [options.orgId ?? null, options.now.toISOString(), ONBOARDING_WINDOW_DAYS],
  );
  return result.rows;
}

/**
 * What this member still owes the team.
 *
 * Announcements are limited to ones posted at or after they joined: chasing a
 * new student to acknowledge a departure time from a competition they were not
 * on is noise, and noise is how the next reminder gets ignored.
 */
async function loadOutstanding(
  client: PoolClient,
  candidate: CandidateRow,
): Promise<OnboardingOutstanding> {
  const forms = await client.query<{ title: string }>(
    `SELECT f.title
       FROM form_assignments fa
       JOIN forms f ON f.id = fa.form_id
      WHERE fa.user_id = $1::uuid
        AND fa.org_id = $2::uuid
        AND f.status = 'open'
        AND NOT EXISTS (
          SELECT 1 FROM form_responses r
           WHERE r.form_id = fa.form_id
             AND r.respondent_user_id = fa.user_id
        )
      ORDER BY fa.assigned_at
      LIMIT ${MAX_ITEMS_LISTED}`,
    [candidate.userId, candidate.orgId],
  );

  const announcements = await client.query<{ title: string }>(
    `SELECT a.title
       FROM team_announcements a
      WHERE a.org_id = $2::uuid
        AND a.require_ack = true
        AND a.created_at >= $3::timestamptz
        AND NOT EXISTS (
          SELECT 1 FROM announcement_acks k
           WHERE k.announcement_id = a.id AND k.user_id = $1::uuid
        )
      ORDER BY a.created_at DESC
      LIMIT ${MAX_ITEMS_LISTED}`,
    [candidate.userId, candidate.orgId, candidate.joinedAt],
  );

  return {
    profileIncomplete: candidate.profileIncomplete,
    openForms: forms.rows.map((row) => row.title),
    unacknowledged: announcements.rows.map((row) => row.title),
  };
}

/** Claim the (org, member, stage) row before sending. False means a previous run had it. */
async function claimStage(
  client: PoolClient,
  input: { orgId: string; userId: string; stage: OnboardingStage },
): Promise<boolean> {
  const inserted = await client.query(
    `INSERT INTO member_onboarding_email_log (org_id, user_id, stage, status, detail)
     VALUES ($1::uuid, $2::uuid, $3, 'failed', 'claimed')
     ON CONFLICT (org_id, user_id, stage) DO NOTHING
     RETURNING id`,
    [input.orgId, input.userId, input.stage],
  );
  return Boolean(inserted.rowCount);
}

async function finalizeStage(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    stage: OnboardingStage;
    status: "sent" | "skipped_pref" | "skipped_nothing_due" | "failed";
    detail: string | null;
  },
): Promise<void> {
  await client.query(
    `UPDATE member_onboarding_email_log
        SET status = $4, detail = $5, updated_at = now()
      WHERE org_id = $1::uuid AND user_id = $2::uuid AND stage = $3`,
    [input.orgId, input.userId, input.stage, input.status, input.detail],
  );
}

export async function runMemberOnboarding(
  options: { orgId?: string; now?: Date } = {},
): Promise<MemberOnboardingRunSummary> {
  const now = options.now ?? new Date();
  const baseUrl = resolveAuthBaseURL();

  const summary: MemberOnboardingRunSummary = {
    membersScanned: 0,
    emailsSent: 0,
    skippedPref: 0,
    skippedNothingDue: 0,
    alreadyStaged: 0,
    failed: 0,
    errors: [],
  };

  const pool = workerPool();
  const client = await pool.connect();
  try {
    const candidates = await listCandidates(client, { orgId: options.orgId, now });
    summary.membersScanned = candidates.length;

    for (const candidate of candidates) {
      const stage = stageForAge(candidate.daysSinceJoin);
      if (!stage) continue;
      try {
        const claimed = await claimStage(client, {
          orgId: candidate.orgId,
          userId: candidate.userId,
          stage,
        });
        if (!claimed) {
          summary.alreadyStaged += 1;
          continue;
        }

        const outstanding = await loadOutstanding(client, candidate);
        const message = renderOnboardingEmail({
          stage,
          orgName: candidate.orgName,
          teamNumber: candidate.teamNumber,
          memberName: candidate.memberName,
          outstanding,
          baseUrl,
        });

        if (!message) {
          // Nothing to say. The claim stays so this stage is not retried
          // tomorrow with the same empty hands.
          await finalizeStage(client, {
            orgId: candidate.orgId,
            userId: candidate.userId,
            stage,
            status: "skipped_nothing_due",
            detail: null,
          });
          summary.skippedNothingDue += 1;
          continue;
        }

        let status: "sent" | "skipped_pref" | "failed" = "failed";
        let detail: string | null = null;
        try {
          const delivery = await sendMemberOnboardingEmail(client, {
            userId: candidate.userId,
            subject: message.subject,
            text: message.text,
          });
          if (delivery.status === "sent") status = "sent";
          else if (delivery.status === "skipped") {
            status = "skipped_pref";
            detail = delivery.reason;
          } else {
            detail = delivery.reason;
          }
        } catch (error) {
          detail = error instanceof Error ? error.message.slice(0, 300) : "send failed";
        }

        await finalizeStage(client, {
          orgId: candidate.orgId,
          userId: candidate.userId,
          stage,
          status,
          detail,
        });
        if (status === "sent") summary.emailsSent += 1;
        else if (status === "skipped_pref") summary.skippedPref += 1;
        else summary.failed += 1;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        summary.errors.push(
          `${candidate.orgId}: ${error instanceof Error ? error.message : "onboarding email failed"}`,
        );
      }
    }
    return summary;
  } finally {
    client.release();
    await pool.end();
  }
}
