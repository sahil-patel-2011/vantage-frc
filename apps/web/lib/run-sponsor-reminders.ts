import { Pool, type PoolClient } from "@neondatabase/serverless";
import {
  emitPreferredNotification,
  resolveAuthBaseURL,
  sendSponsorReminderEmail,
} from "@vantage/core";
import {
  buildSponsorReminders,
  isPipelineStage,
  mapLegacyStatusToPipelineStage,
  type PipelineSponsor,
  type SponsorReminder,
  type SponsorReminderKind,
} from "./sponsor-pipeline";

export type SponsorReminderRunSummary = {
  orgsScanned: number;
  remindersFound: number;
  remindersEmitted: number;
  inAppSent: number;
  emailsSent: number;
  emailsSkipped: number;
  errors: string[];
};

const NOTIFICATION_TYPE: Record<SponsorReminderKind, string> = {
  thank_you: "sponsor_thank_you_due",
  renewal: "sponsor_renewal_due",
  follow_up: "sponsor_followup_overdue",
};

function workerPool(): Pool {
  const connectionString =
    process.env.DATABASE_ADMIN_URL?.trim() ||
    process.env.DATABASE_URL_UNPOOLED?.trim() ||
    process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("DATABASE_ADMIN_URL or DATABASE_URL is required for sponsor reminder cron");
  }
  return new Pool({ connectionString });
}

function isoToday(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function reminderTitle(kind: SponsorReminderKind): string {
  if (kind === "thank_you") return "Thank-you due";
  if (kind === "renewal") return "Renewal window";
  return "Follow-up overdue";
}

async function loadOrgSponsors(client: PoolClient, orgId: string): Promise<PipelineSponsor[]> {
  const result = await client.query<{
    id: string;
    name: string;
    status: string;
    pipelineStage: string | null;
    askCents: string | null;
    pledgedCents: string | null;
    seasonCashCents: string | null;
    thankYouDueOn: string | null;
    renewalDueOn: string | null;
    nextFollowUpOn: string | null;
    lastContactOn: string | null;
    hasUnthanked: boolean;
  }>(
    `SELECT s.id,
            s.name,
            s.status::text AS status,
            s.pipeline_stage::text AS "pipelineStage",
            ROUND(COALESCE(s.ask_amount_usd, 0) * 100)::text AS "askCents",
            ROUND(COALESCE(s.pledged_amount_usd, 0) * 100)::text AS "pledgedCents",
            ROUND(COALESCE((
              SELECT SUM(c.amount_usd) FROM sponsor_contributions c
              WHERE c.org_id = s.org_id AND c.sponsor_id = s.id AND c.type = 'cash'
            ), 0) * 100)::text AS "seasonCashCents",
            s.thank_you_due_on::text AS "thankYouDueOn",
            s.renewal_due_on::text AS "renewalDueOn",
            COALESCE(interaction.next_follow_up_on, s.next_follow_up_on)::text AS "nextFollowUpOn",
            interaction.last_contact_on::text AS "lastContactOn",
            EXISTS (
              SELECT 1 FROM sponsor_contributions c
              WHERE c.org_id = s.org_id AND c.sponsor_id = s.id AND c.thank_you_sent_at IS NULL
            ) AS "hasUnthanked"
     FROM sponsors s
     LEFT JOIN LATERAL (
       SELECT MAX(occurred_at::date) AS last_contact_on,
              (ARRAY_AGG(next_follow_up_on ORDER BY occurred_at DESC)
                FILTER (WHERE next_follow_up_on IS NOT NULL))[1] AS next_follow_up_on
       FROM sponsor_interactions i
       WHERE i.org_id = s.org_id AND i.sponsor_id = s.id
     ) interaction ON true
     WHERE s.org_id = $1::uuid`,
    [orgId],
  );

  return result.rows.map((row) => {
    const stage =
      row.pipelineStage && isPipelineStage(row.pipelineStage)
        ? row.pipelineStage
        : mapLegacyStatusToPipelineStage(row.status);
    return {
      id: row.id,
      name: row.name,
      pipelineStage: stage,
      status: row.status,
      askCents: Math.round(Number(row.askCents ?? 0)),
      pledgedCents: Math.round(Number(row.pledgedCents ?? 0)),
      seasonCents: Math.round(Number(row.seasonCashCents ?? 0)),
      seasonCashCents: Math.round(Number(row.seasonCashCents ?? 0)),
      thankYouDueOn: row.thankYouDueOn,
      renewalDueOn: row.renewalDueOn,
      nextFollowUpOn: row.nextFollowUpOn,
      lastContactOn: row.lastContactOn,
      thankYouSentAt: row.hasUnthanked ? null : "handled",
    };
  });
}

async function claimReminder(
  client: PoolClient,
  orgId: string,
  reminder: SponsorReminder,
  today: string,
): Promise<boolean> {
  const inserted = await client.query(
    `INSERT INTO sponsor_reminder_events (org_id, sponsor_id, kind, due_on, notified_on)
     VALUES ($1::uuid, $2::uuid, $3, $4::date, $5::date)
     ON CONFLICT (org_id, sponsor_id, kind, due_on) DO NOTHING
     RETURNING id`,
    [orgId, reminder.sponsorId, reminder.kind, reminder.dueOn, today],
  );
  return Boolean(inserted.rowCount);
}

async function notifyOrgAdmins(
  client: PoolClient,
  input: { orgId: string; orgName: string; reminder: SponsorReminder },
): Promise<{ inApp: number; emailsSent: number; emailsSkipped: number }> {
  const admins = await client.query<{ userId: string }>(
    `SELECT user_id AS "userId" FROM memberships
     WHERE org_id = $1::uuid AND role IN ('owner', 'admin')`,
    [input.orgId],
  );
  const href = `/business?orgId=${encodeURIComponent(input.orgId)}&tab=sponsors`;
  const type = NOTIFICATION_TYPE[input.reminder.kind];
  const title = reminderTitle(input.reminder.kind);
  let inApp = 0;
  let emailsSent = 0;
  let emailsSkipped = 0;

  for (const admin of admins.rows) {
    const emitted = await emitPreferredNotification(client, {
      userId: admin.userId,
      orgId: input.orgId,
      type,
      payload: {
        title,
        body: input.reminder.message,
        summary: input.reminder.message,
        sponsorId: input.reminder.sponsorId,
        sponsorName: input.reminder.sponsorName,
        dueOn: input.reminder.dueOn,
        kind: input.reminder.kind,
        href,
      },
    });
    if (emitted.emitted) inApp += 1;

    const email = await sendSponsorReminderEmail(client, {
      userId: admin.userId,
      orgName: input.orgName,
      summary: `${title}: ${input.reminder.message} (due ${input.reminder.dueOn})`,
      href: `${resolveAuthBaseURL()}${href}`,
    });
    if (email.status === "sent") emailsSent += 1;
    else emailsSkipped += 1;
  }

  return { inApp, emailsSent, emailsSkipped };
}

/** Daily worker: emit overdue thank-you / renewal / follow-up nudges once per due date. */
export async function runSponsorReminders(now = new Date()): Promise<SponsorReminderRunSummary> {
  const summary: SponsorReminderRunSummary = {
    orgsScanned: 0,
    remindersFound: 0,
    remindersEmitted: 0,
    inAppSent: 0,
    emailsSent: 0,
    emailsSkipped: 0,
    errors: [],
  };
  const today = isoToday(now);
  const pool = workerPool();
  const client = await pool.connect();
  try {
    const orgs = await client.query<{ orgId: string; orgName: string }>(
      `SELECT id AS "orgId", name AS "orgName" FROM organizations WHERE COALESCE(is_demo, false) = false`,
    );
    summary.orgsScanned = orgs.rows.length;

    for (const org of orgs.rows) {
      try {
        const sponsors = await loadOrgSponsors(client, org.orgId);
        const reminders = buildSponsorReminders(sponsors, now);
        summary.remindersFound += reminders.length;

        for (const reminder of reminders) {
          const claimed = await claimReminder(client, org.orgId, reminder, today);
          if (!claimed) continue;
          summary.remindersEmitted += 1;
          const sent = await notifyOrgAdmins(client, {
            orgId: org.orgId,
            orgName: org.orgName,
            reminder,
          });
          summary.inAppSent += sent.inApp;
          summary.emailsSent += sent.emailsSent;
          summary.emailsSkipped += sent.emailsSkipped;
        }
      } catch (error) {
        summary.errors.push(
          `${org.orgId}: ${error instanceof Error ? error.message : "sponsor reminder failed"}`,
        );
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
  return summary;
}
