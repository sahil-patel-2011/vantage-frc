import { randomBytes } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { isEmailProviderConfigured, resolveAuthBaseURL, runtimeEnv } from "./access-policy";
import { createEmailProvider } from "./email";

/** Opt-in email categories. All default OFF — never send without an explicit true preference. */
export const EMAIL_NOTIFICATION_CATEGORIES = [
  "product_updates",
  "coach_assignments",
  "coach_todos",
  "coach_practice_reminders",
] as const;

export type EmailNotificationCategory = (typeof EMAIL_NOTIFICATION_CATEGORIES)[number];

export type UserEmailPreferences = {
  productUpdates: boolean;
  coachAssignments: boolean;
  coachTodos: boolean;
  coachPracticeReminders: boolean;
};

export const DEFAULT_EMAIL_PREFERENCES: UserEmailPreferences = {
  productUpdates: false,
  coachAssignments: false,
  coachTodos: false,
  coachPracticeReminders: false,
};

const CATEGORY_COLUMNS: Record<EmailNotificationCategory, keyof UserEmailPreferences> = {
  product_updates: "productUpdates",
  coach_assignments: "coachAssignments",
  coach_todos: "coachTodos",
  coach_practice_reminders: "coachPracticeReminders",
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

function mapPrefsRow(row: {
  productUpdates: boolean;
  coachAssignments: boolean;
  coachTodos: boolean;
  coachPracticeReminders: boolean;
}): UserEmailPreferences {
  return {
    productUpdates: Boolean(row.productUpdates),
    coachAssignments: Boolean(row.coachAssignments),
    coachTodos: Boolean(row.coachTodos),
    coachPracticeReminders: Boolean(row.coachPracticeReminders),
  };
}

/** Ensure a prefs row exists (all categories false). Safe under self RLS. */
export async function ensureUserEmailPreferences(client: PoolClient, userId: string) {
  const existing = await client.query<{
    productUpdates: boolean;
    coachAssignments: boolean;
    coachTodos: boolean;
    coachPracticeReminders: boolean;
  }>(
    `SELECT product_updates AS "productUpdates",
            coach_assignments AS "coachAssignments",
            coach_todos AS "coachTodos",
            coach_practice_reminders AS "coachPracticeReminders"
     FROM user_email_preferences WHERE user_id = $1::uuid`,
    [userId],
  );
  if (existing.rows[0]) return mapPrefsRow(existing.rows[0]);

  const inserted = await client.query<{
    productUpdates: boolean;
    coachAssignments: boolean;
    coachTodos: boolean;
    coachPracticeReminders: boolean;
  }>(
    `INSERT INTO user_email_preferences (user_id, unsubscribe_token)
     VALUES ($1::uuid, $2)
     ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
     RETURNING product_updates AS "productUpdates",
               coach_assignments AS "coachAssignments",
               coach_todos AS "coachTodos",
               coach_practice_reminders AS "coachPracticeReminders"`,
    [userId, newUnsubscribeToken()],
  );
  return mapPrefsRow(inserted.rows[0] ?? DEFAULT_EMAIL_PREFERENCES);
}

export async function getUserEmailPreferences(client: PoolClient, userId: string) {
  return ensureUserEmailPreferences(client, userId);
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
       updated_at = now()
     WHERE user_id = $1::uuid`,
    [
      userId,
      next.productUpdates,
      next.coachAssignments,
      next.coachTodos,
      next.coachPracticeReminders,
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
  try {
    await createEmailProvider().sendFreeform({
      to: recipient.email,
      subject: input.subject,
      text: body,
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
