import type { PoolClient } from "@neondatabase/serverless";
import {
  buildUnsubscribeUrl,
  emailNotificationsSetupStatus,
  ensureUserEmailPreferences,
} from "./email-notifications";
import { isEmailProviderConfigured, resolveAuthBaseURL, runtimeEnv } from "./access-policy";
import { createEmailProvider } from "./email";
import { emitPreferredNotification } from "./in-app-notifications";

export const PRODUCT_RELEASE_AUDIENCES = ["all", "paid", "max", "plan_codes"] as const;
export type ProductReleaseAudience = (typeof PRODUCT_RELEASE_AUDIENCES)[number];

export const PRODUCT_RELEASE_STATUSES = ["draft", "scheduled", "published", "cancelled"] as const;
export type ProductReleaseStatus = (typeof PRODUCT_RELEASE_STATUSES)[number];

/** Plan rank for min_plan gates (individual/team tracks share ranks). */
export const PRODUCT_PLAN_RANK: Record<string, number> = {
  free: 0,
  // 0481 pricing ladder.
  pro: 20,
  pro_plus: 25,
  max: 30,
  // Legacy codes, ranked where their alias lands (packages/billing maps them).
  access: 20,
  individual_pro: 20,
  team_pro: 25,
  team_trial: 20,
  managed_20: 20,
  individual_max: 30,
  team_max: 30,
  managed_50: 30,
};

export const PAID_PLAN_CODES = [
  "access",
  "individual_pro",
  "individual_max",
  "team_pro",
  "team_max",
  "team_trial",
  "managed_20",
  "managed_50",
] as const;

export const MAX_PLAN_CODES = ["individual_max", "team_max", "managed_50"] as const;

export type ProductRelease = {
  id: string;
  slug: string;
  title: string;
  versionLabel: string | null;
  notesMarkdown: string;
  audienceType: ProductReleaseAudience;
  audiencePlanCodes: string[];
  minPlan: string | null;
  featureFlags: Record<string, boolean>;
  status: ProductReleaseStatus;
  scheduledAt: string | null;
  publishedAt: string | null;
  notifyEmail: boolean;
  notifyInApp: boolean;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProductReleaseInput = {
  slug: string;
  title: string;
  versionLabel?: string | null;
  notesMarkdown: string;
  audienceType: ProductReleaseAudience;
  audiencePlanCodes?: string[];
  minPlan?: string | null;
  featureFlags?: Record<string, boolean>;
  status?: ProductReleaseStatus;
  scheduledAt?: string | null;
  notifyEmail?: boolean;
  notifyInApp?: boolean;
};

function mapRelease(row: {
  id: string;
  slug: string;
  title: string;
  versionLabel: string | null;
  notesMarkdown: string;
  audienceType: string;
  audiencePlanCodes: string[] | null;
  minPlan: string | null;
  featureFlags: Record<string, boolean> | null;
  status: string;
  scheduledAt: Date | string | null;
  publishedAt: Date | string | null;
  notifyEmail: boolean;
  notifyInApp: boolean;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}): ProductRelease {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    versionLabel: row.versionLabel,
    notesMarkdown: row.notesMarkdown,
    audienceType: row.audienceType as ProductReleaseAudience,
    audiencePlanCodes: row.audiencePlanCodes ?? [],
    minPlan: row.minPlan,
    featureFlags: row.featureFlags ?? {},
    status: row.status as ProductReleaseStatus,
    scheduledAt: row.scheduledAt ? new Date(row.scheduledAt).toISOString() : null,
    publishedAt: row.publishedAt ? new Date(row.publishedAt).toISOString() : null,
    notifyEmail: Boolean(row.notifyEmail),
    notifyInApp: Boolean(row.notifyInApp),
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

const RELEASE_SELECT = `id, slug, title,
  version_label AS "versionLabel",
  notes_markdown AS "notesMarkdown",
  audience_type AS "audienceType",
  audience_plan_codes AS "audiencePlanCodes",
  min_plan AS "minPlan",
  feature_flags AS "featureFlags",
  status,
  scheduled_at AS "scheduledAt",
  published_at AS "publishedAt",
  notify_email AS "notifyEmail",
  notify_in_app AS "notifyInApp",
  created_by AS "createdBy",
  updated_by AS "updatedBy",
  created_at AS "createdAt",
  updated_at AS "updatedAt"`;

export function planMeetsMinPlan(planCode: string, minPlan: string | null | undefined): boolean {
  if (!minPlan) return true;
  return (PRODUCT_PLAN_RANK[planCode] ?? 0) >= (PRODUCT_PLAN_RANK[minPlan] ?? 0);
}

export function audienceIncludesPlan(
  audienceType: ProductReleaseAudience,
  audiencePlanCodes: string[],
  planCode: string,
): boolean {
  if (audienceType === "all") return true;
  if (audienceType === "paid") return planCode !== "free";
  if (audienceType === "max") return (MAX_PLAN_CODES as readonly string[]).includes(planCode);
  return audiencePlanCodes.includes(planCode);
}

export function releaseTargetsPlan(
  release: Pick<ProductRelease, "audienceType" | "audiencePlanCodes" | "minPlan">,
  planCode: string,
): boolean {
  if (!audienceIncludesPlan(release.audienceType, release.audiencePlanCodes, planCode)) {
    return false;
  }
  return planMeetsMinPlan(planCode, release.minPlan);
}

/** Merge plan entitlement flags with unlocked release flags for a plan. */
export function mergeEntitlementFeatureFlags(
  baseFlags: Record<string, boolean>,
  releaseFlags: Record<string, boolean>,
): Record<string, boolean> {
  const merged = { ...baseFlags };
  for (const [key, value] of Object.entries(releaseFlags)) {
    if (value) merged[key] = true;
  }
  return merged;
}

export async function loadReleaseFeatureFlagsForPlan(
  client: PoolClient,
  planCode: string,
): Promise<Record<string, boolean>> {
  const result = await client.query<{ featureFlags: Record<string, boolean> }>(
    `SELECT feature_flags AS "featureFlags"
     FROM product_releases
     WHERE status = 'published'
       AND product_release_targets_plan(audience_type, audience_plan_codes, min_plan, $1)`,
    [planCode],
  );
  const flags: Record<string, boolean> = {};
  for (const row of result.rows) {
    for (const [key, value] of Object.entries(row.featureFlags ?? {})) {
      if (value) flags[key] = true;
    }
  }
  return flags;
}

export async function listProductReleases(
  client: PoolClient,
  options: { status?: ProductReleaseStatus | "all" } = {},
): Promise<ProductRelease[]> {
  const status = options.status ?? "all";
  const result = await client.query(
    status === "all"
      ? `SELECT ${RELEASE_SELECT} FROM product_releases ORDER BY created_at DESC`
      : `SELECT ${RELEASE_SELECT} FROM product_releases WHERE status = $1 ORDER BY created_at DESC`,
    status === "all" ? [] : [status],
  );
  return result.rows.map(mapRelease);
}

export async function getProductRelease(
  client: PoolClient,
  idOrSlug: string,
): Promise<ProductRelease | null> {
  const result = await client.query(
    `SELECT ${RELEASE_SELECT} FROM product_releases
     WHERE id::text = $1 OR lower(slug) = lower($1)
     LIMIT 1`,
    [idOrSlug],
  );
  return result.rows[0] ? mapRelease(result.rows[0]) : null;
}

function normalizeInput(input: ProductReleaseInput) {
  const slug = input.slug.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  const audiencePlanCodes =
    input.audienceType === "plan_codes"
      ? Array.from(new Set((input.audiencePlanCodes ?? []).map((c) => c.trim()).filter(Boolean)))
      : [];
  if (!slug || slug.length < 2) throw new Error("slug is required");
  if (input.audienceType === "plan_codes" && audiencePlanCodes.length === 0) {
    throw new Error("plan_codes audience requires at least one plan code");
  }
  const status = input.status ?? "draft";
  if (status === "scheduled" && !input.scheduledAt) {
    throw new Error("scheduled releases require scheduledAt");
  }
  return {
    slug,
    title: input.title.trim(),
    versionLabel: input.versionLabel?.trim() || null,
    notesMarkdown: input.notesMarkdown.trim(),
    audienceType: input.audienceType,
    audiencePlanCodes,
    minPlan: input.minPlan?.trim() || null,
    featureFlags: input.featureFlags ?? {},
    status,
    scheduledAt: input.scheduledAt ? new Date(input.scheduledAt).toISOString() : null,
    notifyEmail: input.notifyEmail ?? true,
    notifyInApp: input.notifyInApp ?? true,
  };
}

export async function createProductRelease(
  client: PoolClient,
  input: ProductReleaseInput,
  actorUserId: string,
): Promise<ProductRelease> {
  const data = normalizeInput(input);
  const publishedAt = data.status === "published" ? new Date().toISOString() : null;
  const result = await client.query(
    `INSERT INTO product_releases (
       slug, title, version_label, notes_markdown, audience_type, audience_plan_codes,
       min_plan, feature_flags, status, scheduled_at, published_at,
       notify_email, notify_in_app, created_by, updated_by
     ) VALUES (
       $1, $2, $3, $4, $5, $6::text[], $7, $8::jsonb, $9, $10::timestamptz, $11::timestamptz,
       $12, $13, $14::uuid, $14::uuid
     )
     RETURNING ${RELEASE_SELECT}`,
    [
      data.slug,
      data.title,
      data.versionLabel,
      data.notesMarkdown,
      data.audienceType,
      data.audiencePlanCodes,
      data.minPlan,
      JSON.stringify(data.featureFlags),
      data.status,
      data.scheduledAt,
      publishedAt,
      data.notifyEmail,
      data.notifyInApp,
      actorUserId,
    ],
  );
  return mapRelease(result.rows[0]);
}

export async function updateProductRelease(
  client: PoolClient,
  id: string,
  input: Partial<ProductReleaseInput> & { status?: ProductReleaseStatus },
  actorUserId: string,
): Promise<ProductRelease> {
  const existing = await getProductRelease(client, id);
  if (!existing) throw new Error("Release not found");
  const merged = normalizeInput({
    slug: input.slug ?? existing.slug,
    title: input.title ?? existing.title,
    versionLabel: input.versionLabel !== undefined ? input.versionLabel : existing.versionLabel,
    notesMarkdown: input.notesMarkdown ?? existing.notesMarkdown,
    audienceType: input.audienceType ?? existing.audienceType,
    audiencePlanCodes: input.audiencePlanCodes ?? existing.audiencePlanCodes,
    minPlan: input.minPlan !== undefined ? input.minPlan : existing.minPlan,
    featureFlags: input.featureFlags ?? existing.featureFlags,
    status: input.status ?? existing.status,
    scheduledAt: input.scheduledAt !== undefined ? input.scheduledAt : existing.scheduledAt,
    notifyEmail: input.notifyEmail ?? existing.notifyEmail,
    notifyInApp: input.notifyInApp ?? existing.notifyInApp,
  });

  let publishedAt = existing.publishedAt;
  if (merged.status === "published" && existing.status !== "published") {
    publishedAt = new Date().toISOString();
  }
  if (merged.status !== "published") {
    publishedAt = existing.status === "published" ? existing.publishedAt : null;
  }

  const result = await client.query(
    `UPDATE product_releases SET
       slug = $2,
       title = $3,
       version_label = $4,
       notes_markdown = $5,
       audience_type = $6,
       audience_plan_codes = $7::text[],
       min_plan = $8,
       feature_flags = $9::jsonb,
       status = $10,
       scheduled_at = $11::timestamptz,
       published_at = $12::timestamptz,
       notify_email = $13,
       notify_in_app = $14,
       updated_by = $15::uuid,
       updated_at = now()
     WHERE id = $1::uuid
     RETURNING ${RELEASE_SELECT}`,
    [
      id,
      merged.slug,
      merged.title,
      merged.versionLabel,
      merged.notesMarkdown,
      merged.audienceType,
      merged.audiencePlanCodes,
      merged.minPlan,
      JSON.stringify(merged.featureFlags),
      merged.status,
      merged.scheduledAt,
      publishedAt,
      merged.notifyEmail,
      merged.notifyInApp,
      actorUserId,
    ],
  );
  return mapRelease(result.rows[0]);
}

function emailDeliveryConfigured() {
  if (process.env.NODE_ENV !== "production") return { ok: true as const };
  if (!isEmailProviderConfigured()) {
    return {
      ok: false as const,
      reason: "Email delivery requires RESEND_API_KEY and AUTH_EMAIL_FROM.",
    };
  }
  return { ok: true as const };
}

export type ReleaseNotifyResult = {
  delivery: "sent" | "setup_required" | "skipped";
  attempted: number;
  emailsSent: number;
  emailsSkipped: number;
  emailErrors: number;
  inAppSent: number;
  inAppSkipped: number;
  reason?: string;
};

async function ensureRecipientPrefs(client: PoolClient, userId: string) {
  return ensureUserEmailPreferences(client, userId);
}

export async function notifyProductRelease(
  client: PoolClient,
  releaseId: string,
): Promise<ReleaseNotifyResult> {
  const release = await getProductRelease(client, releaseId);
  if (!release || release.status !== "published") {
    return {
      delivery: "skipped",
      attempted: 0,
      emailsSent: 0,
      emailsSkipped: 0,
      emailErrors: 0,
      inAppSent: 0,
      inAppSkipped: 0,
      reason: "Release is not published",
    };
  }

  const deliveryCheck = emailDeliveryConfigured();
  const wantEmail = release.notifyEmail;
  const wantInApp = release.notifyInApp;

  if (wantEmail && !deliveryCheck.ok) {
    return {
      delivery: "setup_required",
      attempted: 0,
      emailsSent: 0,
      emailsSkipped: 0,
      emailErrors: 0,
      inAppSent: 0,
      inAppSkipped: 0,
      reason: deliveryCheck.reason,
    };
  }

  const recipients = await client.query<{
    userId: string;
    email: string;
    unsubscribeToken: string;
  }>(
    `SELECT user_id AS "userId", email, unsubscribe_token AS "unsubscribeToken"
     FROM list_product_release_notify_recipients($1::uuid)`,
    [releaseId],
  );

  // Also notify in-app for targeted members even when email pref is off.
  const inAppTargets = wantInApp
    ? await client.query<{ userId: string }>(
        `SELECT DISTINCT m.user_id AS "userId"
         FROM memberships m
         JOIN org_entitlements e ON e.org_id = m.org_id
         WHERE e.status = 'active'
           AND (e.valid_until IS NULL OR e.valid_until > now())
           AND product_release_targets_plan(
             $1, $2::text[], $3, e.plan_code
           )`,
        [release.audienceType, release.audiencePlanCodes, release.minPlan],
      )
    : { rows: [] as { userId: string }[] };

  let emailsSent = 0;
  let emailsSkipped = 0;
  let emailErrors = 0;
  let inAppSent = 0;
  let inAppSkipped = 0;

  const href = `${resolveAuthBaseURL()}/whats-new#${release.slug}`;
  const subject = release.versionLabel
    ? `${release.title} (${release.versionLabel})`
    : release.title;
  const bodyText = `${release.title}${release.versionLabel ? ` — ${release.versionLabel}` : ""}

${release.notesMarkdown}

—
What's new: ${href}
Manage email preferences: ${resolveAuthBaseURL()}/notifications/preferences`;

  const provider = wantEmail && deliveryCheck.ok ? createEmailProvider() : null;

  const emailByUser = new Map(recipients.rows.map((r) => [r.userId, r]));

  const allUserIds = new Set<string>([
    ...recipients.rows.map((r) => r.userId),
    ...inAppTargets.rows.map((r) => r.userId),
  ]);

  for (const userId of allUserIds) {
    let emailStatus: string = wantEmail ? "pending" : "not_requested";
    let inAppStatus: string = wantInApp ? "pending" : "not_requested";
    let emailError: string | null = null;

    if (wantEmail) {
      const row = emailByUser.get(userId);
      if (!row) {
        emailStatus = "skipped";
        emailsSkipped += 1;
      } else {
        await ensureRecipientPrefs(client, userId);
        let token = row.unsubscribeToken?.trim();
        if (!token) {
          const prefs = await ensureUserEmailPreferences(client, userId);
          // ensure creates token; re-read
          const tok = await client.query<{ token: string }>(
            `SELECT unsubscribe_token AS token FROM user_email_preferences WHERE user_id = $1::uuid`,
            [userId],
          );
          token = tok.rows[0]?.token ?? "";
          void prefs;
        }
        try {
          const footer = token
            ? `\nUnsubscribe from product updates: ${buildUnsubscribeUrl(token, "product_updates")}`
            : "";
          await provider!.sendFreeform({
            to: row.email,
            subject,
            text: `${bodyText}${footer}`,
          });
          emailStatus = "sent";
          emailsSent += 1;
        } catch (error) {
          emailStatus = "error";
          emailErrors += 1;
          emailError = error instanceof Error ? error.message : "Email send failed";
        }
      }
    }

    if (wantInApp) {
      const emitted = await emitPreferredNotification(client, {
        userId,
        type: "product_update",
        payload: {
          title: subject,
          body: release.notesMarkdown.slice(0, 280),
          href: `/whats-new#${release.slug}`,
          releaseId: release.id,
          slug: release.slug,
        },
      });
      if (emitted.emitted) {
        inAppStatus = "sent";
        inAppSent += 1;
      } else {
        inAppStatus = "skipped";
        inAppSkipped += 1;
      }
    }

    await client.query(
      `INSERT INTO product_release_deliveries (
         release_id, user_id, email_status, in_app_status, email_error, notified_at
       ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, now())
       ON CONFLICT (release_id, user_id) DO UPDATE SET
         email_status = EXCLUDED.email_status,
         in_app_status = EXCLUDED.in_app_status,
         email_error = EXCLUDED.email_error,
         notified_at = now()`,
      [releaseId, userId, emailStatus, inAppStatus, emailError],
    );
  }

  return {
    delivery: "sent",
    attempted: allUserIds.size,
    emailsSent,
    emailsSkipped,
    emailErrors,
    inAppSent,
    inAppSkipped,
  };
}

export async function publishProductRelease(
  client: PoolClient,
  releaseId: string,
  actorUserId: string | null,
  options: { notify?: boolean } = {},
): Promise<{ release: ProductRelease; notify?: ReleaseNotifyResult }> {
  const existing = await getProductRelease(client, releaseId);
  if (!existing) throw new Error("Release not found");

  const result = await client.query(
    `UPDATE product_releases SET
       status = 'published',
       published_at = COALESCE(published_at, now()),
       scheduled_at = NULL,
       updated_by = COALESCE($2::uuid, updated_by),
       updated_at = now()
     WHERE id = $1::uuid
     RETURNING ${RELEASE_SELECT}`,
    [releaseId, actorUserId],
  );
  const release = mapRelease(result.rows[0]);
  if (options.notify === false) return { release };
  const notify = await notifyProductRelease(client, releaseId);
  return { release, notify };
}

/** Publish scheduled releases whose scheduled_at has passed. Used by Hobby-safe season cron piggyback. */
export async function publishDueProductReleases(
  client: PoolClient,
): Promise<{ published: ProductRelease[]; notifies: ReleaseNotifyResult[] }> {
  const due = await client.query<{ id: string }>(
    `SELECT id FROM product_releases
     WHERE status = 'scheduled'
       AND scheduled_at IS NOT NULL
       AND scheduled_at <= now()
     ORDER BY scheduled_at ASC
     LIMIT 50`,
  );
  const published: ProductRelease[] = [];
  const notifies: ReleaseNotifyResult[] = [];
  for (const row of due.rows) {
    const result = await publishProductRelease(client, row.id, null, { notify: true });
    published.push(result.release);
    if (result.notify) notifies.push(result.notify);
  }
  return { published, notifies };
}

export async function listWhatsNewForUser(
  client: PoolClient,
  userId: string,
): Promise<Array<ProductRelease & { seenAt: string | null }>> {
  const plans = await client.query<{ planCode: string }>(
    `SELECT DISTINCT e.plan_code AS "planCode"
     FROM memberships m
     JOIN org_entitlements e ON e.org_id = m.org_id
     WHERE m.user_id = $1::uuid
       AND e.status = 'active'
       AND (e.valid_until IS NULL OR e.valid_until > now())`,
    [userId],
  );
  const planCodes = plans.rows.map((r) => r.planCode);
  if (planCodes.length === 0) {
    // No org yet — still show "all" audience releases.
    planCodes.push("free");
  }

  const result = await client.query(
    `SELECT ${RELEASE_SELECT},
            a.seen_at AS "seenAt"
     FROM product_releases r
     LEFT JOIN product_release_acks a
       ON a.release_id = r.id AND a.user_id = $1::uuid
     WHERE r.status = 'published'
     ORDER BY r.published_at DESC NULLS LAST, r.created_at DESC
     LIMIT 100`,
    [userId],
  );

  return result.rows
    .map((row) => ({ ...mapRelease(row), seenAt: row.seenAt ? new Date(row.seenAt).toISOString() : null }))
    .filter((release) => planCodes.some((code) => releaseTargetsPlan(release, code)));
}

export async function ackProductRelease(
  client: PoolClient,
  userId: string,
  releaseId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO product_release_acks (release_id, user_id, seen_at)
     VALUES ($1::uuid, $2::uuid, now())
     ON CONFLICT (release_id, user_id) DO UPDATE SET seen_at = now()`,
    [releaseId, userId],
  );
}

export function productReleasesEmailSetupStatus() {
  return emailNotificationsSetupStatus();
}

/** Soft-check for admin UI — mirrors emailNotificationsSetupStatus. */
export function productReleaseDeliverySetupStatus() {
  if (process.env.NODE_ENV !== "production") {
    return { status: "available" as const, detail: "Local mailbox provider (development)." };
  }
  const apiKey = runtimeEnv("RESEND_API_KEY");
  const from = runtimeEnv("AUTH_EMAIL_FROM");
  if (apiKey && from) {
    return { status: "available" as const, detail: "Resend is configured for release emails." };
  }
  return {
    status: "setup_required" as const,
    detail: "Set RESEND_API_KEY and AUTH_EMAIL_FROM to deliver release-note emails.",
  };
}
