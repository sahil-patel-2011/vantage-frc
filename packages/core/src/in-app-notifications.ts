import type { PoolClient } from "@neondatabase/serverless";
import { emitNotification } from "./notifications-emit";

/**
 * In-app inbox preferences stored on `profiles.notification_prefs` (jsonb).
 * Distinct from email categories in `user_email_preferences`.
 * Team-ops and product updates default ON; users can opt out.
 */
export type InAppNotificationPrefs = {
  matchAlerts: boolean;
  scoutReminders: boolean;
  syncFailures: boolean;
  productUpdates: boolean;
  todoAssigned: boolean;
  todoCompleted: boolean;
  dutyAssigned: boolean;
  calendarEvents: boolean;
  sponsorReminders: boolean;
  teamChat: boolean;
  performanceDigest: boolean;
};

export const DEFAULT_IN_APP_NOTIFICATION_PREFS: InAppNotificationPrefs = {
  matchAlerts: true,
  scoutReminders: true,
  syncFailures: true,
  productUpdates: true,
  todoAssigned: true,
  todoCompleted: true,
  dutyAssigned: true,
  calendarEvents: true,
  sponsorReminders: true,
  teamChat: true,
  performanceDigest: true,
};

/** Preference key that gates a notification `type` (null = always allow). */
export type InAppPrefKey = keyof InAppNotificationPrefs;

const TYPE_PREF: Record<string, InAppPrefKey | null> = {
  todo_assigned: "todoAssigned",
  todo_completed: "todoCompleted",
  duty_assigned: "dutyAssigned",
  calendar_event: "calendarEvents",
  calendar_updated: "calendarEvents",
  match_alert: "matchAlerts",
  scout_reminder: "scoutReminders",
  scouting_coverage_gap: "scoutReminders",
  sync_failure: "syncFailures",
  product_update: "productUpdates",
  sponsor_thank_you_due: "sponsorReminders",
  sponsor_renewal_due: "sponsorReminders",
  sponsor_followup_overdue: "sponsorReminders",
  team_chat: "teamChat",
  message_mention: "teamChat",
  performance_digest: "performanceDigest",
  // Membership-critical access-request lifecycle: never gated by prefs.
  team_access_request: null,
  team_access_approved: null,
  team_access_declined: null,
};

export function prefKeyForNotificationType(type: string): InAppPrefKey | null {
  if (Object.prototype.hasOwnProperty.call(TYPE_PREF, type)) {
    return TYPE_PREF[type] ?? null;
  }
  return null;
}

export function mergeInAppNotificationPrefs(raw: unknown): InAppNotificationPrefs {
  const base = { ...DEFAULT_IN_APP_NOTIFICATION_PREFS };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const obj = raw as Record<string, unknown>;
  for (const key of Object.keys(base) as InAppPrefKey[]) {
    if (typeof obj[key] === "boolean") base[key] = obj[key];
  }
  return base;
}

export async function loadInAppNotificationPrefs(
  client: PoolClient,
  userId: string,
): Promise<InAppNotificationPrefs> {
  const result = await client.query<{ notificationPrefs: unknown }>(
    `SELECT notification_prefs AS "notificationPrefs" FROM profiles WHERE user_id = $1::uuid`,
    [userId],
  );
  return mergeInAppNotificationPrefs(result.rows[0]?.notificationPrefs);
}

export async function userAllowsInAppNotification(
  client: PoolClient,
  userId: string,
  type: string,
): Promise<boolean> {
  const prefKey = prefKeyForNotificationType(type);
  if (!prefKey) return true;
  const prefs = await loadInAppNotificationPrefs(client, userId);
  return prefs[prefKey];
}

/**
 * Insert an inbox row only when the recipient's in-app prefs allow this type.
 * Skips silently when opted out. Still requires a peer-insert RLS policy for
 * cross-user types (todo_assigned, duty_assigned, calendar_event, …).
 */
export async function emitPreferredNotification(
  client: PoolClient,
  input: { userId: string; orgId?: string; type: string; payload?: Record<string, unknown> },
): Promise<{ emitted: boolean }> {
  const allowed = await userAllowsInAppNotification(client, input.userId, input.type);
  if (!allowed) return { emitted: false };
  await emitNotification(client, input);
  return { emitted: true };
}

type PreferredNotificationInput = {
  userId: string;
  orgId?: string;
  type: string;
  payload?: Record<string, unknown>;
};

/**
 * Batch form of emitPreferredNotification for fan-outs (a team-chat message
 * notifies every member): one prefs read for all recipients and one insert,
 * instead of two queries per recipient. Same rules per input — a missing
 * profile means default prefs, pref-free types always pass — and the inserted
 * rows arrive in input order. Returns one `emitted` flag per input.
 */
export async function emitPreferredNotifications(
  client: PoolClient,
  inputs: readonly PreferredNotificationInput[],
): Promise<Array<{ emitted: boolean }>> {
  if (!inputs.length) return [];
  const gatedUserIds = [
    ...new Set(inputs.filter((input) => prefKeyForNotificationType(input.type)).map((input) => input.userId)),
  ];
  const prefsByUser = new Map<string, InAppNotificationPrefs>();
  if (gatedUserIds.length) {
    const result = await client.query<{ userId: string; notificationPrefs: unknown }>(
      `SELECT user_id::text AS "userId", notification_prefs AS "notificationPrefs"
       FROM profiles WHERE user_id = ANY($1::uuid[])`,
      [gatedUserIds],
    );
    for (const row of result.rows) {
      prefsByUser.set(row.userId.toLowerCase(), mergeInAppNotificationPrefs(row.notificationPrefs));
    }
  }
  const flags = inputs.map((input) => {
    const prefKey = prefKeyForNotificationType(input.type);
    if (!prefKey) return { emitted: true };
    const prefs = prefsByUser.get(input.userId.toLowerCase()) ?? mergeInAppNotificationPrefs(undefined);
    return { emitted: prefs[prefKey] };
  });
  const allowed = inputs.filter((_, index) => flags[index]!.emitted);
  if (allowed.length) {
    await client.query(
      `INSERT INTO notifications (user_id, org_id, type, payload)
       SELECT n.user_id, n.org_id, n.type, n.payload::jsonb
       FROM unnest($1::uuid[], $2::uuid[], $3::text[], $4::text[]) WITH ORDINALITY
         AS n(user_id, org_id, type, payload, ord)
       ORDER BY n.ord`,
      [
        allowed.map((input) => input.userId),
        allowed.map((input) => input.orgId ?? null),
        allowed.map((input) => input.type),
        allowed.map((input) => JSON.stringify(input.payload ?? {})),
      ],
    );
  }
  return flags;
}
