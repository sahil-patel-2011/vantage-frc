import type { PoolClient } from "@neondatabase/serverless";
import { emitNotification } from "./notifications-emit";

/**
 * In-app inbox preferences stored on `profiles.notification_prefs` (jsonb).
 * Distinct from opt-in email categories in `user_email_preferences`.
 * Team-ops categories default ON (actionable coach→member alerts); product notes default OFF.
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
};

export const DEFAULT_IN_APP_NOTIFICATION_PREFS: InAppNotificationPrefs = {
  matchAlerts: true,
  scoutReminders: true,
  syncFailures: true,
  productUpdates: false,
  todoAssigned: true,
  todoCompleted: true,
  dutyAssigned: true,
  calendarEvents: true,
  sponsorReminders: true,
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
