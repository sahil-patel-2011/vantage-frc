// Grant deadline alert worker: 30 / 14 / 3 days before a WATCHED grant closes.
//
// Evidence (docs/COMMUNITY_DEMAND_RND.md): mentors ask "Is there a way to sign up for an email
// notification when the Boeing grant opens?" — the answer today is to lurk in a forum thread.
// This is that sign-up.
//
// It deliberately builds NO new notification system:
//   * in-app  -> `emitPreferredNotification` (honors the member's in-app type prefs)
//   * email   -> `sendOptInEmail` with the existing `sponsor_reminders` fundraising category,
//                which is opt-in (default OFF) and appends the standard unsubscribe +
//                manage-preferences footer. A member who unsubscribed still gets the in-app row.
//   * once    -> `grant_calendar_alert_events` (0458), same claim-then-send shape as
//                `sponsor_reminder_events` in lib/run-sponsor-reminders.ts.
//
// Worker role only: this runs as vantage_worker off the admin pool, exactly like the sponsor
// reminder cron. Nothing in the request path imports this file.

import { createSqlPool } from "@vantage/db/pool";
import { firstConfiguredEnv } from "@vantage/db/postgres-url";
import type { Pool, PoolClient } from "@neondatabase/serverless";
import {
  emitPreferredNotification,
  resolveAuthBaseURL,
  sendOptInEmail,
} from "@vantage/core";
import { alertMilestoneForClose } from "./eligibility";

export const GRANT_DEADLINE_NOTIFICATION_TYPE = "grant_deadline_approaching";

export type GrantDeadlineAlertRunSummary = {
  orgsScanned: number;
  watchesScanned: number;
  alertsClaimed: number;
  inAppSent: number;
  emailsSent: number;
  emailsSkipped: number;
  errors: string[];
};

type WatchRow = {
  orgId: string;
  orgName: string;
  opportunityId: string;
  memberUserId: string;
  name: string;
  funder: string;
  url: string | null;
  closesOn: string;
  typicalAmountUsd: string | null;
};

function workerPool(): Pool {
  const connectionString = firstConfiguredEnv(
    "DATABASE_ADMIN_URL",
    "DATABASE_URL_UNPOOLED",
    "POSTGRES_URL_NON_POOLING",
    "DATABASE_URL",
    "POSTGRES_URL",
  );
  if (!connectionString) {
    throw new Error("DATABASE_ADMIN_URL or DATABASE_URL is required for grant deadline alerts");
  }
  return createSqlPool(connectionString);
}

function money(value: string | null): string | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return `$${Math.round(parsed).toLocaleString("en-US")}`;
}

/**
 * Every watch with `notify` on whose grant closes within the widest milestone band.
 * Demo orgs are excluded, matching the sponsor reminder cron.
 */
async function loadDueWatches(client: PoolClient): Promise<WatchRow[]> {
  const result = await client.query<WatchRow>(
    `SELECT w.org_id AS "orgId",
            o.name AS "orgName",
            w.opportunity_id AS "opportunityId",
            w.member_user_id AS "memberUserId",
            g.name,
            g.funder,
            g.url,
            g.closes_on::text AS "closesOn",
            g.typical_amount_usd::text AS "typicalAmountUsd"
     FROM grant_calendar_watchlist w
     JOIN grant_calendar_opportunities g ON g.id = w.opportunity_id
     JOIN organizations o ON o.id = w.org_id
     JOIN memberships m ON m.org_id = w.org_id AND m.user_id = w.member_user_id
     WHERE w.notify = true
       AND g.is_active = true
       AND g.closes_on IS NOT NULL
       AND g.closes_on >= CURRENT_DATE
       AND g.closes_on <= CURRENT_DATE + INTERVAL '30 days'
       AND COALESCE(o.is_demo, false) = false
     ORDER BY g.closes_on, w.org_id`,
  );
  return result.rows;
}

/**
 * Write-once claim. The unique key includes `closes_on`, so if a funder moves the deadline the
 * team is legitimately warned again against the new date rather than being silently skipped.
 */
async function claimAlert(
  client: PoolClient,
  watch: WatchRow,
  milestoneDays: 30 | 14 | 3,
): Promise<boolean> {
  const inserted = await client.query(
    `INSERT INTO grant_calendar_alert_events
       (org_id, opportunity_id, member_user_id, milestone_days, closes_on)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::int, $5::date)
     ON CONFLICT (org_id, opportunity_id, member_user_id, milestone_days, closes_on)
     DO NOTHING
     RETURNING id`,
    [watch.orgId, watch.opportunityId, watch.memberUserId, milestoneDays, watch.closesOn],
  );
  return Boolean(inserted.rowCount);
}

async function notifyWatcher(
  client: PoolClient,
  watch: WatchRow,
  milestoneDays: 30 | 14 | 3,
): Promise<{ inApp: number; emailsSent: number; emailsSkipped: number }> {
  const href = `/team/grants/calendar?orgId=${encodeURIComponent(watch.orgId)}`;
  const amount = money(watch.typicalAmountUsd);
  // Every milestone (30/14/3) is plural, so no singular branch is reachable here.
  const title = `${watch.name} closes in ${milestoneDays} days`;
  const body = [
    `${watch.funder} — ${watch.name} closes ${watch.closesOn}.`,
    amount ? `Typical award ${amount}.` : null,
    watch.url ? `Application: ${watch.url}` : null,
  ]
    .filter(Boolean)
    .join(" ");

  let inApp = 0;
  let emailsSent = 0;
  let emailsSkipped = 0;

  const emitted = await emitPreferredNotification(client, {
    userId: watch.memberUserId,
    orgId: watch.orgId,
    type: GRANT_DEADLINE_NOTIFICATION_TYPE,
    payload: {
      title,
      body,
      summary: body,
      opportunityId: watch.opportunityId,
      grantName: watch.name,
      funder: watch.funder,
      closesOn: watch.closesOn,
      milestoneDays,
      href,
    },
  });
  if (emitted.emitted) inApp += 1;

  const email = await sendOptInEmail(client, {
    userId: watch.memberUserId,
    // Reuses the existing opt-in fundraising category so there is one place to unsubscribe.
    category: "sponsor_reminders",
    subject: `Grant deadline — ${watch.name} closes in ${milestoneDays} days`,
    text: `${watch.orgName}\n\n${body}\n\nYou are watching this grant in Vantage.\nOpen the grant calendar: ${resolveAuthBaseURL()}${href}`,
  });
  if (email.status === "sent") emailsSent += 1;
  else emailsSkipped += 1;

  return { inApp, emailsSent, emailsSkipped };
}

/** Daily worker: warn every watcher at 30/14/3 days before their grant closes, exactly once. */
export async function runGrantDeadlineAlerts(
  now = new Date(),
): Promise<GrantDeadlineAlertRunSummary> {
  const summary: GrantDeadlineAlertRunSummary = {
    orgsScanned: 0,
    watchesScanned: 0,
    alertsClaimed: 0,
    inAppSent: 0,
    emailsSent: 0,
    emailsSkipped: 0,
    errors: [],
  };

  const pool = workerPool();
  const client = await pool.connect();
  try {
    const watches = await loadDueWatches(client);
    summary.watchesScanned = watches.length;
    summary.orgsScanned = new Set(watches.map((watch) => watch.orgId)).size;

    for (const watch of watches) {
      try {
        const milestone = alertMilestoneForClose(watch.closesOn, now);
        if (milestone === null) continue;
        const claimed = await claimAlert(client, watch, milestone);
        if (!claimed) continue;
        summary.alertsClaimed += 1;
        const sent = await notifyWatcher(client, watch, milestone);
        summary.inAppSent += sent.inApp;
        summary.emailsSent += sent.emailsSent;
        summary.emailsSkipped += sent.emailsSkipped;
      } catch (error) {
        summary.errors.push(
          `${watch.orgId}/${watch.opportunityId}: ${
            error instanceof Error ? error.message : "grant deadline alert failed"
          }`,
        );
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
  return summary;
}
