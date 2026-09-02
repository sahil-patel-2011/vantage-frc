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
  scout_shift_assigned: "scoutReminders",
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

// ---------------------------------------------------------------------------------------------
// Set-based fan-out
// ---------------------------------------------------------------------------------------------

export type OrgFanoutInput = {
  orgId: string;
  type: string;
  payload?: Record<string, unknown>;
  /** Never notify these members (typically the actor). */
  excludeUserIds?: string[];
  /** When set, notify only these members (e.g. the people @mentioned). */
  onlyUserIds?: string[] | null;
  /**
   * When set, notify only members of this chat channel (org_conversation_members). Ignored when
   * migration 0494 has not run, in which case the whole org is the audience.
   */
  conversationId?: string | null;
};

/**
 * One INSERT ... SELECT for the whole audience. With migration 0494 the member list and the
 * per-member preference gate come from the SECURITY DEFINER `org_notification_targets()`;
 * `profiles` is self-read-only under RLS, so a request-role join could never see a teammate's
 * opt-out (which is why the old per-member loop effectively notified everyone). Before that
 * migration the query falls back to the plain memberships/profiles join, i.e. the same rows the
 * old loop produced.
 */
export function buildOrgFanoutQuery(
  input: OrgFanoutInput,
  options: { viaFunction: boolean },
): { text: string; values: unknown[] } {
  const prefKey = prefKeyForNotificationType(input.type);
  const exclude = [...new Set(input.excludeUserIds ?? [])];
  const only = input.onlyUserIds == null ? null : [...new Set(input.onlyUserIds)];
  const values: unknown[] = [
    input.orgId,
    input.type,
    JSON.stringify(input.payload ?? {}),
    exclude,
    only,
    prefKey,
    input.conversationId ?? null,
  ];
  const audience = options.viaFunction
    ? `FROM org_notification_targets($1::uuid, $6::text, $7::uuid) t`
    : `FROM (
         SELECT m.user_id
         FROM memberships m
         LEFT JOIN profiles p ON p.user_id = m.user_id
         WHERE m.org_id = $1::uuid
           AND ($6::text IS NULL OR COALESCE((p.notification_prefs->>$6::text)::boolean, true) IS TRUE)
       ) t`;
  const text = `INSERT INTO notifications (user_id, org_id, type, payload)
     SELECT t.user_id, $1::uuid, $2::text, $3::jsonb
     ${audience}
     WHERE NOT (t.user_id = ANY($4::uuid[]))
       AND ($5::uuid[] IS NULL OR t.user_id = ANY($5::uuid[]))`;
  return { text, values };
}

let fanoutFunctionCache: boolean | null = null;

async function supportsFanoutFunction(client: PoolClient): Promise<boolean> {
  if (fanoutFunctionCache != null) return fanoutFunctionCache;
  try {
    const row = await client.query<{ present: boolean }>(
      `SELECT to_regprocedure('public.org_notification_targets(uuid, text, uuid)') IS NOT NULL AS present`,
    );
    fanoutFunctionCache = Boolean(row.rows[0]?.present);
  } catch {
    fanoutFunctionCache = false;
  }
  return fanoutFunctionCache;
}

/**
 * Notify every member of an org (or a subset) in one statement, honouring each recipient's in-app
 * preference for this type. Returns how many inbox rows were written. Requires a peer-insert RLS
 * policy on `notifications` for the type, exactly like emitNotification().
 */
export async function emitNotificationToOrgMembers(
  client: PoolClient,
  input: OrgFanoutInput,
): Promise<{ emitted: number }> {
  if (input.onlyUserIds && input.onlyUserIds.length === 0) return { emitted: 0 };
  const viaFunction = await supportsFanoutFunction(client);
  const query = buildOrgFanoutQuery(input, { viaFunction });
  const result = await client.query(query.text, query.values);
  return { emitted: result.rowCount ?? 0 };
}
