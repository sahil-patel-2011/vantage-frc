import { Pool, type PoolClient } from "@neondatabase/serverless";
import {
  buildUnsubscribeUrl,
  createEmailProvider,
  emitPreferredNotification,
  ensureUserEmailPreferences,
  isEmailProviderConfigured,
  resolveAuthBaseURL,
} from "@vantage/core";

export type ProductReleaseCronSummary = {
  publishedCount: number;
  releaseIds: string[];
  emailsSent: number;
  inAppSent: number;
  setupRequired: boolean;
  errors: string[];
};

function workerPool(): Pool {
  const connectionString =
    process.env.DATABASE_ADMIN_URL?.trim() ||
    process.env.DATABASE_URL_UNPOOLED?.trim() ||
    process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("DATABASE_ADMIN_URL or DATABASE_URL is required for product release cron");
  }
  return new Pool({ connectionString });
}

/**
 * Publish due scheduled releases and fan out email / inbox notifications.
 * Piggybacked on season TBA cron — Hobby allows only 2 Vercel crons.
 */
export async function runProductReleasePublish(): Promise<ProductReleaseCronSummary> {
  const pool = workerPool();
  const summary: ProductReleaseCronSummary = {
    publishedCount: 0,
    releaseIds: [],
    emailsSent: 0,
    inAppSent: 0,
    setupRequired: false,
    errors: [],
  };
  try {
    const client = await pool.connect();
    try {
      const due = await client.query<{ id: string }>(
        `UPDATE product_releases SET
           status = 'published',
           published_at = COALESCE(published_at, now()),
           scheduled_at = NULL,
           updated_at = now()
         WHERE id IN (
           SELECT id FROM product_releases
           WHERE status = 'scheduled'
             AND scheduled_at IS NOT NULL
             AND scheduled_at <= now()
           ORDER BY scheduled_at ASC
           LIMIT 50
           FOR UPDATE SKIP LOCKED
         )
         RETURNING id`,
      );

      for (const row of due.rows) {
        summary.releaseIds.push(row.id);
        summary.publishedCount += 1;
        try {
          const notify = await notifyReleaseAsWorker(client, row.id);
          summary.emailsSent += notify.emailsSent;
          summary.inAppSent += notify.inAppSent;
          if (notify.setupRequired) summary.setupRequired = true;
        } catch (error) {
          summary.errors.push(
            error instanceof Error ? `${row.id}: ${error.message}` : `${row.id}: notify failed`,
          );
        }
      }
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
  return summary;
}

async function notifyReleaseAsWorker(client: PoolClient, releaseId: string) {
  const releaseResult = await client.query<{
    slug: string;
    title: string;
    versionLabel: string | null;
    notesMarkdown: string;
    audienceType: string;
    audiencePlanCodes: string[];
    minPlan: string | null;
    notifyEmail: boolean;
    notifyInApp: boolean;
    status: string;
  }>(
    `SELECT slug, title, version_label AS "versionLabel", notes_markdown AS "notesMarkdown",
            audience_type AS "audienceType", audience_plan_codes AS "audiencePlanCodes",
            min_plan AS "minPlan", notify_email AS "notifyEmail", notify_in_app AS "notifyInApp",
            status
     FROM product_releases WHERE id = $1::uuid`,
    [releaseId],
  );
  const release = releaseResult.rows[0];
  if (!release || release.status !== "published") {
    return { emailsSent: 0, inAppSent: 0, setupRequired: false };
  }

  const setupRequired =
    release.notifyEmail &&
    process.env.NODE_ENV === "production" &&
    !isEmailProviderConfigured();
  if (setupRequired) {
    return { emailsSent: 0, inAppSent: 0, setupRequired: true };
  }

  const members = await client.query<{
    userId: string;
    email: string | null;
    productUpdates: boolean | null;
  }>(
    `SELECT DISTINCT m.user_id AS "userId", u.email,
            p.product_updates AS "productUpdates"
     FROM memberships m
     JOIN org_entitlements e ON e.org_id = m.org_id
     JOIN users u ON u.id = m.user_id
     LEFT JOIN user_email_preferences p ON p.user_id = u.id
     WHERE e.status = 'active'
       AND (e.valid_until IS NULL OR e.valid_until > now())
       AND product_release_targets_plan(
         $1, $2::text[], $3, e.plan_code
       )`,
    [release.audienceType, release.audiencePlanCodes, release.minPlan],
  );

  const href = `${resolveAuthBaseURL()}/whats-new#${release.slug}`;
  const subject = release.versionLabel
    ? `${release.title} (${release.versionLabel})`
    : release.title;
  const provider = release.notifyEmail && !setupRequired ? createEmailProvider() : null;

  let emailsSent = 0;
  let inAppSent = 0;

  for (const member of members.rows) {
    let emailStatus = release.notifyEmail ? "skipped" : "not_requested";
    let inAppStatus = release.notifyInApp ? "skipped" : "not_requested";

    if (release.notifyEmail && provider && member.email?.trim() && member.productUpdates !== false) {
      await ensureUserEmailPreferences(client, member.userId);
      const tok = await client.query<{ token: string }>(
        `SELECT unsubscribe_token AS token FROM user_email_preferences WHERE user_id = $1::uuid`,
        [member.userId],
      );
      const token = tok.rows[0]?.token ?? "";
      const body = `${release.title}${release.versionLabel ? ` — ${release.versionLabel}` : ""}

${release.notesMarkdown}

—
What's new: ${href}
Manage email preferences: ${resolveAuthBaseURL()}/notifications/preferences
${token ? `Unsubscribe: ${buildUnsubscribeUrl(token, "product_updates")}` : ""}`;
      try {
        await provider.sendFreeform({ to: member.email, subject, text: body });
        emailStatus = "sent";
        emailsSent += 1;
      } catch {
        emailStatus = "error";
      }
    }

    if (release.notifyInApp) {
      // Worker pool bypasses RLS; emit without platform-admin session.
      const emitted = await emitPreferredNotification(client, {
        userId: member.userId,
        type: "product_update",
        payload: {
          title: subject,
          body: release.notesMarkdown.slice(0, 280),
          href: `/whats-new#${release.slug}`,
          releaseId,
          slug: release.slug,
        },
      });
      if (emitted.emitted) {
        inAppStatus = "sent";
        inAppSent += 1;
      }
    }

    await client.query(
      `INSERT INTO product_release_deliveries (
         release_id, user_id, email_status, in_app_status, notified_at
       ) VALUES ($1::uuid, $2::uuid, $3, $4, now())
       ON CONFLICT (release_id, user_id) DO UPDATE SET
         email_status = EXCLUDED.email_status,
         in_app_status = EXCLUDED.in_app_status,
         notified_at = now()`,
      [releaseId, member.userId, emailStatus, inAppStatus],
    );
  }

  return { emailsSent, inAppSent, setupRequired: false };
}
