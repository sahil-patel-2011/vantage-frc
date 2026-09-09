import { randomBytes } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { withSavepoint } from "@vantage/db/savepoint";
import { isEmailProviderConfigured, resolveAuthBaseURL, runtimeEnv } from "./access-policy";
import { createEmailProvider } from "./email";

/**
 * Email notification categories.
 *
 * A category is a promise to the reader: "this switch turns off exactly this
 * kind of message and nothing else". That is why dues reminders, announcements
 * and new-member onboarding each get their own entry rather than riding on
 * `coach_todos` — a student who wants nothing but the dues notice, or a family
 * who wants the urgent announcements and nothing more, has to be able to say so.
 * The product is used by minors and their guardians; consent is per-thing.
 *
 * Adding one means: this list, `UserEmailPreferences`, the defaults, the column
 * map, `categoryLabel`, the read/write SQL below, the preferences UI, and a
 * migration extending `resolve_opt_in_email_recipient(s)` and
 * `apply_email_unsubscribe`. Miss any one of those and the switch lies.
 *
 * Defaults: product updates, the daily performance digest, urgent
 * announcements, dues reminders and new-member onboarding are ON (opt-out);
 * the coach/sponsor categories are OFF (opt-in).
 */
export const EMAIL_NOTIFICATION_CATEGORIES = [
  "product_updates",
  "coach_assignments",
  "coach_todos",
  "coach_practice_reminders",
  "sponsor_reminders",
  "performance_digest",
  "announcements",
  "dues_reminders",
  "member_onboarding",
] as const;

export type EmailNotificationCategory = (typeof EMAIL_NOTIFICATION_CATEGORIES)[number];

export type UserEmailPreferences = {
  productUpdates: boolean;
  coachAssignments: boolean;
  coachTodos: boolean;
  coachPracticeReminders: boolean;
  sponsorReminders: boolean;
  performanceDigest: boolean;
  announcements: boolean;
  duesReminders: boolean;
  memberOnboarding: boolean;
};

export const DEFAULT_EMAIL_PREFERENCES: UserEmailPreferences = {
  productUpdates: true,
  coachAssignments: false,
  coachTodos: false,
  coachPracticeReminders: false,
  sponsorReminders: false,
  performanceDigest: true,
  announcements: true,
  duesReminders: true,
  memberOnboarding: true,
};

const CATEGORY_COLUMNS: Record<EmailNotificationCategory, keyof UserEmailPreferences> = {
  product_updates: "productUpdates",
  coach_assignments: "coachAssignments",
  coach_todos: "coachTodos",
  coach_practice_reminders: "coachPracticeReminders",
  sponsor_reminders: "sponsorReminders",
  performance_digest: "performanceDigest",
  announcements: "announcements",
  dues_reminders: "duesReminders",
  member_onboarding: "memberOnboarding",
};

export function isEmailNotificationCategory(value: string): value is EmailNotificationCategory {
  return (EMAIL_NOTIFICATION_CATEGORIES as readonly string[]).includes(value);
}

export function categoryLabel(category: EmailNotificationCategory) {
  switch (category) {
    case "product_updates":
      return "Product updates";
    case "coach_assignments":
      return "Coach assignments";
    case "coach_todos":
      return "Coach todos";
    case "coach_practice_reminders":
      return "Practice reminders";
    case "sponsor_reminders":
      return "Sponsor reminders";
    case "performance_digest":
      return "Daily performance digest";
    case "announcements":
      return "Urgent team announcements";
    case "dues_reminders":
      return "Dues reminders";
    case "member_onboarding":
      return "New member onboarding";
  }
}

export function newUnsubscribeToken() {
  return randomBytes(32).toString("base64url");
}

export type EmailDeliveryStatus =
  | { status: "sent" }
  | { status: "skipped"; reason: "not_opted_in" | "no_email" }
  | { status: "setup_required"; reason: string }
  | { status: "error"; reason: string };

type PrefsRow = {
  productUpdates: boolean;
  coachAssignments: boolean;
  coachTodos: boolean;
  coachPracticeReminders: boolean;
  sponsorReminders: boolean;
  performanceDigest: boolean;
  announcements: boolean;
  duesReminders: boolean;
  memberOnboarding: boolean;
};

/** The projection every prefs read shares, so a new column cannot be added to one and missed in the other. */
const PREFS_COLUMNS = `product_updates AS "productUpdates",
            coach_assignments AS "coachAssignments",
            coach_todos AS "coachTodos",
            coach_practice_reminders AS "coachPracticeReminders",
            COALESCE(sponsor_reminders, false) AS "sponsorReminders",
            COALESCE(performance_digest, true) AS "performanceDigest",
            COALESCE(announcements, true) AS "announcements",
            COALESCE(dues_reminders, true) AS "duesReminders",
            COALESCE(member_onboarding, true) AS "memberOnboarding"`;

function mapPrefsRow(row: PrefsRow): UserEmailPreferences {
  return {
    productUpdates: Boolean(row.productUpdates),
    coachAssignments: Boolean(row.coachAssignments),
    coachTodos: Boolean(row.coachTodos),
    coachPracticeReminders: Boolean(row.coachPracticeReminders),
    sponsorReminders: Boolean(row.sponsorReminders),
    performanceDigest: Boolean(row.performanceDigest),
    announcements: Boolean(row.announcements),
    duesReminders: Boolean(row.duesReminders),
    memberOnboarding: Boolean(row.memberOnboarding),
  };
}

/** Ensure a prefs row exists (see DEFAULT_EMAIL_PREFERENCES). Safe under self RLS. */
export async function ensureUserEmailPreferences(client: PoolClient, userId: string) {
  const existing = await client.query<PrefsRow>(
    `SELECT ${PREFS_COLUMNS}
     FROM user_email_preferences WHERE user_id = $1::uuid`,
    [userId],
  );
  if (existing.rows[0]) return mapPrefsRow(existing.rows[0]);

  const inserted = await client.query<PrefsRow>(
    `INSERT INTO user_email_preferences (user_id, product_updates, unsubscribe_token)
     VALUES ($1::uuid, true, $2)
     ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
     RETURNING ${PREFS_COLUMNS}`,
    [userId, newUnsubscribeToken()],
  );
  return mapPrefsRow(inserted.rows[0] ?? DEFAULT_EMAIL_PREFERENCES);
}

export async function getUserEmailPreferences(client: PoolClient, userId: string) {
  return ensureUserEmailPreferences(client, userId);
}

/**
 * Make sure other people have a preferences row before mailing them.
 *
 * `ensureUserEmailPreferences` can only ever do this for the caller: the
 * `user_email_preferences_self` policy allows a member to write their own row
 * and nobody else's, so calling it for a teammate is refused by RLS — which
 * aborts the surrounding transaction and takes the rest of the request with it.
 *
 * This goes through `ensure_email_preferences` (0603) instead, which writes the
 * defaults under definer rights for the worker, for yourself, or for an
 * owner/admin acting on a member of their own team. Without it, a default-ON
 * category silently skips everyone who has never opened the preferences page.
 *
 * Never throws — and never poisons the transaction either. A bare try/catch here
 * would be the same trap it exists to avoid: a failed statement leaves the
 * transaction aborted whether or not the error was swallowed, so the guard is a
 * savepoint. On failure the send simply resolves fewer recipients.
 *
 * `mode` exists because a worker runs statements with no open transaction, and
 * `SAVEPOINT` there is itself an error — a harmless one that Postgres still
 * writes to the server log, once per email. That log is where this team finds
 * real problems, so a recurring benign ERROR in it is a cost worth avoiding.
 * Workers have nothing to protect anyway: they connect as vantage_worker, which
 * bypasses RLS, so the write that needed the savepoint cannot fail for them.
 */
export async function ensureEmailPreferencesFor(
  client: PoolClient,
  userIds: string[],
  mode: "transactional" | "autocommit" = "transactional",
): Promise<number> {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (unique.length === 0) return 0;
  const run = async () => {
    const result = await client.query<{ created: number }>(
      `SELECT ensure_email_preferences($1::uuid[]) AS created`,
      [unique],
    );
    return result.rows[0]?.created ?? 0;
  };
  if (mode === "autocommit") {
    return run().catch(() => 0);
  }
  return withSavepoint(client, run, 0);
}

export async function updateUserEmailPreferences(
  client: PoolClient,
  userId: string,
  patch: Partial<UserEmailPreferences>,
) {
  const current = await ensureUserEmailPreferences(client, userId);
  const next = { ...current, ...patch };
  await client.query(
    `UPDATE user_email_preferences SET
       product_updates = $2,
       coach_assignments = $3,
       coach_todos = $4,
       coach_practice_reminders = $5,
       sponsor_reminders = $6,
       performance_digest = $7,
       announcements = $8,
       dues_reminders = $9,
       member_onboarding = $10,
       updated_at = now()
     WHERE user_id = $1::uuid`,
    [
      userId,
      next.productUpdates,
      next.coachAssignments,
      next.coachTodos,
      next.coachPracticeReminders,
      next.sponsorReminders,
      next.performanceDigest,
      next.announcements,
      next.duesReminders,
      next.memberOnboarding,
    ],
  );
  return next;
}

export function buildUnsubscribeUrl(token: string, category: EmailNotificationCategory | "all" = "all") {
  const base = resolveAuthBaseURL();
  const url = new URL("/unsubscribe", `${base}/`);
  url.searchParams.set("token", token);
  url.searchParams.set("category", category);
  return url.toString();
}

export function buildPreferencesUrl() {
  return `${resolveAuthBaseURL()}/notifications/preferences`;
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

function appendUnsubscribeFooter(text: string, token: string, category: EmailNotificationCategory) {
  const unsub = buildUnsubscribeUrl(token, category);
  const prefs = buildPreferencesUrl();
  return `${text.trim()}

—
Manage email preferences: ${prefs}
Unsubscribe from ${categoryLabel(category)}: ${unsub}
Unsubscribe from all Vantage emails: ${buildUnsubscribeUrl(token, "all")}`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Same unsubscribe mechanism as the plain-text footer, rendered for HTML bodies. */
function appendUnsubscribeFooterHtml(html: string, token: string, category: EmailNotificationCategory) {
  const unsub = escapeHtml(buildUnsubscribeUrl(token, category));
  const all = escapeHtml(buildUnsubscribeUrl(token, "all"));
  const prefs = escapeHtml(buildPreferencesUrl());
  return `${html.trim()}
<hr style="border:none;border-top:1px solid #ccc;margin:16px 0" />
<p style="font-size:12px;color:#666">
  <a href="${prefs}">Manage email preferences</a> ·
  <a href="${unsub}">Unsubscribe from ${escapeHtml(categoryLabel(category))}</a> ·
  <a href="${all}">Unsubscribe from all Vantage emails</a>
</p>`;
}

/**
 * Consent-gated send. Never emails when the category is off or no prefs row exists.
 * Returns setup_required when Resend is missing in production (auth OTP path unchanged).
 */
export async function sendOptInEmail(
  client: PoolClient,
  input: {
    userId: string;
    category: EmailNotificationCategory;
    subject: string;
    text: string;
    /** Optional simple-HTML body; the plain-text body is always sent alongside. */
    html?: string;
  },
): Promise<EmailDeliveryStatus> {
  const delivery = emailDeliveryConfigured();
  if (!delivery.ok) return { status: "setup_required", reason: delivery.reason };

  const resolved = await client.query<{ email: string; unsubscribeToken: string }>(
    `SELECT email, unsubscribe_token AS "unsubscribeToken"
     FROM resolve_opt_in_email_recipient($1::uuid, $2)`,
    [input.userId, input.category],
  );
  const recipient = resolved.rows[0];
  if (!recipient) return { status: "skipped", reason: "not_opted_in" };
  if (!recipient.email?.trim()) return { status: "skipped", reason: "no_email" };

  const body = appendUnsubscribeFooter(input.text, recipient.unsubscribeToken, input.category);
  const htmlBody = input.html
    ? appendUnsubscribeFooterHtml(input.html, recipient.unsubscribeToken, input.category)
    : undefined;
  try {
    await createEmailProvider().sendFreeform({
      to: recipient.email,
      subject: input.subject,
      text: body,
      ...(htmlBody ? { html: htmlBody } : {}),
    });
    return { status: "sent" };
  } catch (error) {
    return {
      status: "error",
      reason: error instanceof Error ? error.message : "Email send failed",
    };
  }
}

/** Coach/mentor helper: assignment notice (opt-in `coach_assignments`). */
export async function sendCoachAssignmentEmail(
  client: PoolClient,
  input: { userId: string; orgName: string; summary: string; href?: string },
) {
  const link = input.href ? `\n\nOpen in Vantage: ${input.href}` : "";
  return sendOptInEmail(client, {
    userId: input.userId,
    category: "coach_assignments",
    subject: `Assignment from ${input.orgName}`,
    text: `${input.summary}${link}`,
  });
}

/** Coach/mentor helper: todo notice (opt-in `coach_todos`). */
export async function sendCoachTodoEmail(
  client: PoolClient,
  input: { userId: string; orgName: string; summary: string; href?: string },
) {
  const link = input.href ? `\n\nOpen in Vantage: ${input.href}` : "";
  return sendOptInEmail(client, {
    userId: input.userId,
    category: "coach_todos",
    subject: `Todo from ${input.orgName}`,
    text: `${input.summary}${link}`,
  });
}

/** Coach/mentor helper: practice reminder (opt-in `coach_practice_reminders`). */
export async function sendPracticeReminderEmail(
  client: PoolClient,
  input: {
    userId: string;
    orgName: string;
    sessionTitle: string;
    sessionDate: string;
    location?: string;
    href?: string;
  },
) {
  const where = input.location?.trim() ? `\nLocation: ${input.location.trim()}` : "";
  const link = input.href ? `\n\nOpen in Vantage: ${input.href}` : "";
  return sendOptInEmail(client, {
    userId: input.userId,
    category: "coach_practice_reminders",
    subject: `Practice reminder — ${input.sessionTitle}`,
    text: `${input.orgName} scheduled practice: ${input.sessionTitle}\nDate: ${input.sessionDate}${where}${link}`,
  });
}


/** Team-facing sponsor CRM nudge (opt-in `sponsor_reminders`). Never emails external sponsors. */
export async function sendSponsorReminderEmail(
  client: PoolClient,
  input: { userId: string; orgName: string; summary: string; href?: string },
) {
  const link = input.href ? `\n\nOpen in Vantage: ${input.href}` : "";
  return sendOptInEmail(client, {
    userId: input.userId,
    category: "sponsor_reminders",
    subject: `Sponsor reminder — ${input.orgName}`,
    text: `${input.summary}${link}`,
  });
}

/**
 * Daily team performance digest (default-ON `performance_digest`, per-member
 * opt-out). Ensures a prefs row exists first so brand-new members are covered
 * by the default; the standard unsubscribe footer is appended to both bodies.
 * Callers must only invoke this on days with REAL performance data.
 */
export async function sendPerformanceDigestEmail(
  client: PoolClient,
  input: { userId: string; subject: string; text: string; html?: string },
): Promise<EmailDeliveryStatus> {
  await ensureUserEmailPreferences(client, input.userId);
  return sendOptInEmail(client, {
    userId: input.userId,
    category: "performance_digest",
    subject: input.subject,
    text: input.text,
    html: input.html,
  });
}

export type BulkEmailResult = {
  /** Recipients considered before consent was checked. */
  candidates: number;
  /** Opted in, with a deliverable address. */
  eligible: number;
  sent: number;
  failed: number;
  /** Present when the deployment cannot send at all. Nothing was attempted. */
  setupRequired?: string;
};

/** Sends run a few at a time: a 60-person team should not be 60 serial HTTP round trips. */
const BULK_SEND_CONCURRENCY = 6;

/**
 * Consent-gated fan-out to a known set of members.
 *
 * Resolves every recipient in ONE query through
 * `resolve_opt_in_email_recipients` (0603) — which returns nobody the caller
 * does not already share a workspace with — then sends with a small concurrency
 * limit. A failure to send to one person never stops the rest and never throws;
 * the counts come back so the caller can tell the truth about what happened.
 *
 * The per-recipient body is built by `render`, so a message can address people
 * by name without this function ever holding the whole list in memory twice.
 */
export async function sendBulkOptInEmail(
  client: PoolClient,
  input: {
    userIds: string[];
    category: EmailNotificationCategory;
    subject: string;
    text: string;
    html?: string;
  },
): Promise<BulkEmailResult> {
  const unique = [...new Set(input.userIds.filter(Boolean))];
  const empty: BulkEmailResult = { candidates: unique.length, eligible: 0, sent: 0, failed: 0 };
  if (unique.length === 0) return empty;

  const delivery = emailDeliveryConfigured();
  if (!delivery.ok) return { ...empty, setupRequired: delivery.reason };

  // Materialise default rows first, or the fan-out silently skips every member
  // who has never opened the preferences page — disproportionately the newest
  // ones, who most need to be told the bus leaves at 6:15.
  await ensureEmailPreferencesFor(client, unique);

  const resolved = await client.query<{ userId: string; email: string; unsubscribeToken: string }>(
    `SELECT user_id AS "userId", email, unsubscribe_token AS "unsubscribeToken"
     FROM resolve_opt_in_email_recipients($1::uuid[], $2)`,
    [unique, input.category],
  );

  const recipients = resolved.rows;
  const result: BulkEmailResult = {
    candidates: unique.length,
    eligible: recipients.length,
    sent: 0,
    failed: 0,
  };
  if (recipients.length === 0) return result;

  const provider = createEmailProvider();
  let cursor = 0;
  async function worker() {
    for (;;) {
      const index = cursor++;
      const row = recipients[index];
      if (!row) return;
      try {
        await provider.sendFreeform({
          to: row.email,
          subject: input.subject,
          text: appendUnsubscribeFooter(input.text, row.unsubscribeToken, input.category),
          ...(input.html
            ? { html: appendUnsubscribeFooterHtml(input.html, row.unsubscribeToken, input.category) }
            : {}),
        });
        result.sent += 1;
      } catch {
        result.failed += 1;
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(BULK_SEND_CONCURRENCY, recipients.length) }, () => worker()),
  );
  return result;
}

/**
 * Team announcement email (opt-in `announcements`).
 *
 * Only the caller decides which announcements deserve mail; the announcements
 * feature restricts that to `urgent` priority or `require_ack`, because a
 * normal notice belongs in the in-app inbox that already receives every one of
 * them. Emailing all of them is how a team teaches its members to filter the
 * team's mail into the bin, and then the urgent one gets filtered too.
 */
export async function sendAnnouncementEmails(
  client: PoolClient,
  input: {
    userIds: string[];
    orgName: string;
    title: string;
    body: string;
    priority: string;
    requireAck: boolean;
    href: string;
  },
): Promise<BulkEmailResult> {
  const lead = input.requireAck
    ? "Your team needs everyone to confirm they have read this."
    : "Your team marked this urgent.";
  const trailer = input.requireAck
    ? `\n\nAcknowledge it here: ${input.href}`
    : `\n\nOpen it in Vantage: ${input.href}`;
  const text = `${lead}\n\n${input.title}\n\n${input.body.trim()}${trailer}`;
  const html = `<p style="margin:0 0 12px">${escapeHtml(lead)}</p>
<h2 style="margin:0 0 8px;font-size:18px">${escapeHtml(input.title)}</h2>
<div style="white-space:pre-wrap">${escapeHtml(input.body.trim())}</div>
<p style="margin:16px 0 0"><a href="${escapeHtml(input.href)}">${
    input.requireAck ? "Acknowledge in Vantage" : "Open in Vantage"
  }</a></p>`;

  return sendBulkOptInEmail(client, {
    userIds: input.userIds,
    category: "announcements",
    subject: `${input.requireAck ? "Please confirm" : "Urgent"} — ${input.title} (${input.orgName})`,
    text,
    html,
  });
}

/**
 * Dues reminder (opt-in `dues_reminders`).
 *
 * This helper is deliberately dumb: it takes a body and a user id and sends.
 * Deciding WHO may receive one — and in particular that nobody who asked for
 * financial assistance may — happens in `apps/web/lib/forms/dues-reminders.ts`,
 * where the answers are, and is covered by tests there.
 */
export async function sendDuesReminderEmail(
  client: PoolClient,
  input: { userId: string; subject: string; text: string; html?: string },
): Promise<EmailDeliveryStatus> {
  // NOT ensureUserEmailPreferences: this runs on a treasurer's request
  // connection, and that helper writes the row as the caller, which RLS refuses
  // for anyone else's row — aborting the whole send transaction with it.
  await ensureEmailPreferencesFor(client, [input.userId]);
  return sendOptInEmail(client, {
    userId: input.userId,
    category: "dues_reminders",
    subject: input.subject,
    text: input.text,
    html: input.html,
  });
}

/**
 * New-member onboarding step (opt-in `member_onboarding`).
 *
 * Only ever addressed to a `users` row — someone who has an account, an email
 * address we hold because they signed in with it, a preferences row and an
 * unsubscribe token. A person who answered a public intake form has none of
 * those and is never a recipient here.
 */
export async function sendMemberOnboardingEmail(
  client: PoolClient,
  input: { userId: string; subject: string; text: string; html?: string },
): Promise<EmailDeliveryStatus> {
  // A brand-new member is precisely the person with no preferences row yet, so
  // the default-ON category would resolve to nobody without this. Worker-only
  // caller, hence autocommit — see ensureEmailPreferencesFor.
  await ensureEmailPreferencesFor(client, [input.userId], "autocommit");
  return sendOptInEmail(client, {
    userId: input.userId,
    category: "member_onboarding",
    subject: input.subject,
    text: input.text,
    html: input.html,
  });
}

export type ProductUpdateSendResult = {
  delivery: "sent" | "setup_required";
  attempted: number;
  sent: number;
  skipped: number;
  errors: number;
  reason?: string;
};

/** Platform-admin product/changelog broadcast to opted-in users only. */
export async function sendProductUpdateEmails(
  client: PoolClient,
  input: { subject: string; body: string },
): Promise<ProductUpdateSendResult> {
  const delivery = emailDeliveryConfigured();
  if (!delivery.ok) {
    return {
      delivery: "setup_required",
      attempted: 0,
      sent: 0,
      skipped: 0,
      errors: 0,
      reason: delivery.reason,
    };
  }

  const recipients = await client.query<{
    userId: string;
    email: string;
    unsubscribeToken: string;
  }>(
    `SELECT user_id AS "userId", email, unsubscribe_token AS "unsubscribeToken"
     FROM list_product_update_recipients()`,
  );

  let sent = 0;
  let errors = 0;
  const provider = createEmailProvider();
  for (const row of recipients.rows) {
    try {
      await provider.sendFreeform({
        to: row.email,
        subject: input.subject,
        text: appendUnsubscribeFooter(input.body, row.unsubscribeToken, "product_updates"),
      });
      sent += 1;
    } catch {
      errors += 1;
    }
  }

  return {
    delivery: "sent",
    attempted: recipients.rows.length,
    sent,
    skipped: 0,
    errors,
  };
}

export async function applyUnsubscribeByToken(
  client: PoolClient,
  token: string,
  category: EmailNotificationCategory | "all",
) {
  const result = await client.query<{ ok: boolean }>(
    `SELECT apply_email_unsubscribe($1, $2) AS ok`,
    [token, category],
  );
  return Boolean(result.rows[0]?.ok);
}

/** Pref column accessor for tests / UI mapping. */
export function preferenceKeyForCategory(category: EmailNotificationCategory) {
  return CATEGORY_COLUMNS[category];
}

/** Soft-check used by preference UI when Resend is absent in production. */
export function emailNotificationsSetupStatus() {
  if (process.env.NODE_ENV !== "production") {
    return { status: "available" as const, detail: "Local mailbox provider (development)." };
  }
  const apiKey = runtimeEnv("RESEND_API_KEY");
  const from = runtimeEnv("AUTH_EMAIL_FROM");
  if (apiKey && from) {
    return { status: "available" as const, detail: "Resend is configured for transactional email." };
  }
  return {
    status: "setup_required" as const,
    detail: "Set RESEND_API_KEY and AUTH_EMAIL_FROM to deliver opt-in emails.",
  };
}
