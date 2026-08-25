/**
 * Turning one TBA Firehose delivery into the right pings for the right people.
 *
 * Shape of the pipeline:
 *   TBA POST → /api/webhooks/tba verifies the HMAC and INSERTs into `tba_webhook_events`,
 *   answers 200 inside the 10-second deadline, then processes the row after the response.
 *   Anything that did not finish is picked up by /api/webhooks/tba/drain (cron).
 *
 * We hold ONE platform-level TBA subscription, so the fan-out is ours to do: an event
 * key maps to the orgs whose active context is that event, and from there to the members
 * who actually have a stake in the message — the scout assigned to the match, the leads
 * whose robot is on the field. Every recipient is re-checked against `memberships`, and
 * in-app preferences gate both the inbox row and the push.
 *
 * Worker-role connection (BYPASSRLS) as with the other cron workers: this code fans out
 * across orgs, so there is no single `app.org_id` to scope it to. It is never reachable
 * from a user session — the only callers are the HMAC-verified webhook and the
 * CRON_SECRET-guarded drain.
 */
import type { Pool, PoolClient } from "@neondatabase/serverless";
import { emitPreferredNotification } from "@vantage/core";
import { createSqlPool } from "@vantage/db/pool";
import { firstConfiguredEnv } from "@vantage/db/postgres-url";
import { buildPushPayload } from "../push/payload";
import { sendToSubscriptions, type PushSubscriptionRecord } from "../push/send";
import {
  allianceSelectionNotification,
  describeMatchKey,
  eventKeyForMessage,
  isActionableMessageType,
  matchKeyForMessage,
  matchScoreNotification,
  readAllianceCount,
  readEventName,
  readFirstMatchSeconds,
  readMatchScore,
  readUpcomingMatch,
  scheduleUpdatedNotification,
  teamKeyForNumber,
  upcomingMatchNotificationForScout,
  upcomingMatchNotificationForTeam,
  type NotificationContent,
  type TbaEnvelope,
} from "./tba-messages";

/** Give up after this many failed passes so one poisoned row cannot spin the drain forever. */
export const MAX_TBA_EVENT_ATTEMPTS = 5;

export type TbaEventRow = {
  id: string;
  messageType: string;
  messageData: Record<string, unknown>;
  attempts: number;
};

export type FanOutResult = {
  notified: number;
  pushed: number;
  pruned: number;
  orgs: number;
};

export type DrainSummary = {
  claimed: number;
  processed: number;
  notified: number;
  pushed: number;
  errors: string[];
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
    throw new Error("DATABASE_ADMIN_URL or DATABASE_URL is required for TBA webhook fan-out");
  }
  return createSqlPool(connectionString);
}

/** Run `fn` on one worker connection and always hand it back. */
export async function withWebhookWorker<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const pool = workerPool();
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
    await pool.end();
  }
}

/** Durable record of the delivery. Written before the 200 so nothing is lost on a cold stop. */
export async function recordTbaEvent(
  client: PoolClient,
  envelope: TbaEnvelope,
): Promise<{ id: string }> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO tba_webhook_events (message_type, message_data)
     VALUES ($1::text, $2::jsonb)
     RETURNING id`,
    [envelope.messageType, JSON.stringify(envelope.messageData)],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error("tba_webhook_events insert returned no id");
  return { id };
}

type OrgAtEvent = { orgId: string; teamNumber: number | null };

async function orgsAtEvent(client: PoolClient, eventKey: string): Promise<OrgAtEvent[]> {
  const result = await client.query<{ orgId: string; teamNumber: number | null }>(
    `SELECT c.org_id AS "orgId", o.team_number AS "teamNumber"
       FROM org_active_context c
       JOIN organizations o ON o.id = c.org_id
      WHERE c.active_event_key = $1::text`,
    [eventKey],
  );
  return result.rows;
}

async function orgLeadUserIds(client: PoolClient, orgId: string): Promise<string[]> {
  const result = await client.query<{ userId: string }>(
    `SELECT user_id AS "userId" FROM memberships
      WHERE org_id = $1::uuid AND role = ANY(ARRAY['owner','admin']::org_role[])`,
    [orgId],
  );
  return result.rows.map((row) => row.userId);
}

type ScoutAssignment = { userId: string; teamKeys: string[] };

/** Members with a live assignment on this match, still members of the org today. */
async function scoutsForMatch(
  client: PoolClient,
  orgId: string,
  matchKey: string,
): Promise<ScoutAssignment[]> {
  const result = await client.query<{ userId: string; teamKeys: string[] }>(
    `SELECT a.user_id AS "userId", array_agg(DISTINCT a.team_key) AS "teamKeys"
       FROM scout_assignments a
       JOIN memberships m ON m.org_id = a.org_id AND m.user_id = a.user_id
      WHERE a.org_id = $1::uuid AND a.match_key = $2::text
      GROUP BY a.user_id`,
    [orgId, matchKey],
  );
  return result.rows.map((row) => ({ userId: row.userId, teamKeys: row.teamKeys ?? [] }));
}

async function pushSubscriptionsFor(
  client: PoolClient,
  userIds: string[],
): Promise<Map<string, PushSubscriptionRecord[]>> {
  const byUser = new Map<string, PushSubscriptionRecord[]>();
  if (userIds.length === 0) return byUser;
  const result = await client.query<{
    userId: string;
    endpoint: string;
    p256dh: string;
    auth: string;
  }>(
    `SELECT user_id AS "userId", endpoint, p256dh, auth
       FROM push_subscriptions
      WHERE user_id = ANY($1::uuid[]) AND failed_at IS NULL`,
    [userIds],
  );
  for (const row of result.rows) {
    const list = byUser.get(row.userId) ?? [];
    list.push({ endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth });
    byUser.set(row.userId, list);
  }
  return byUser;
}

/**
 * Inbox row first (it is the durable copy and the one that works without VAPID keys),
 * then push to whatever devices that member registered. A member who muted the category
 * gets neither — the preference is the single switch, not two half-switches.
 */
async function deliver(
  client: PoolClient,
  input: {
    orgId: string;
    userIds: string[];
    type: string;
    content: NotificationContent;
    payload?: Record<string, unknown>;
  },
): Promise<{ notified: number; pushed: number; pruned: number }> {
  const accepted: string[] = [];
  for (const userId of input.userIds) {
    const emitted = await emitPreferredNotification(client, {
      userId,
      orgId: input.orgId,
      type: input.type,
      payload: {
        title: input.content.title,
        body: input.content.body,
        href: input.content.url,
        source: "tba_webhook",
        ...(input.payload ?? {}),
      },
    });
    if (emitted.emitted) accepted.push(userId);
  }
  if (accepted.length === 0) return { notified: 0, pushed: 0, pruned: 0 };

  const subscriptions = await pushSubscriptionsFor(client, accepted);
  const payload = buildPushPayload({
    title: input.content.title,
    body: input.content.body,
    url: input.content.url,
    tag: input.content.tag,
    type: input.type,
    urgent: input.content.urgent,
  });

  let pushed = 0;
  let pruned = 0;
  for (const userId of accepted) {
    const devices = subscriptions.get(userId) ?? [];
    if (devices.length === 0) continue;
    const result = await sendToSubscriptions(client, devices, payload, {
      urgency: input.content.urgent ? "high" : "normal",
      ttlSeconds: input.content.urgent ? 600 : 3600,
    });
    pushed += result.delivered;
    pruned += result.pruned;
  }
  return { notified: accepted.length, pushed, pruned };
}

function mergeInto(target: FanOutResult, part: { notified: number; pushed: number; pruned: number }) {
  target.notified += part.notified;
  target.pushed += part.pushed;
  target.pruned += part.pruned;
}

async function fanOutUpcomingMatch(
  client: PoolClient,
  envelope: TbaEnvelope,
  now: Date,
): Promise<FanOutResult> {
  const result: FanOutResult = { notified: 0, pushed: 0, pruned: 0, orgs: 0 };
  const message = readUpcomingMatch(envelope);
  if (!message.eventKey || !message.matchKey) return result;

  const orgs = await orgsAtEvent(client, message.eventKey);
  result.orgs = orgs.length;
  for (const org of orgs) {
    const scouts = await scoutsForMatch(client, org.orgId, message.matchKey);
    for (const scout of scouts) {
      mergeInto(
        result,
        await deliver(client, {
          orgId: org.orgId,
          userIds: [scout.userId],
          type: "scout_reminder",
          content: upcomingMatchNotificationForScout({
            message,
            assignedTeamKeys: scout.teamKeys,
            now,
          }),
          payload: { matchKey: message.matchKey, eventKey: message.eventKey, teamKeys: scout.teamKeys },
        }),
      );
    }

    // The org's own robot on the field is a leads-and-drive-team ping, separate from scouting.
    const ourKey = org.teamNumber ? teamKeyForNumber(org.teamNumber).toLowerCase() : null;
    const weArePlaying =
      ourKey != null && message.teamKeys.some((key) => key.toLowerCase() === ourKey);
    if (!weArePlaying) continue;
    const leads = (await orgLeadUserIds(client, org.orgId)).filter(
      (userId) => !scouts.some((scout) => scout.userId === userId),
    );
    if (leads.length === 0) continue;
    mergeInto(
      result,
      await deliver(client, {
        orgId: org.orgId,
        userIds: leads,
        type: "match_alert",
        content: upcomingMatchNotificationForTeam({ message, teamNumber: org.teamNumber, now }),
        payload: { matchKey: message.matchKey, eventKey: message.eventKey },
      }),
    );
  }
  return result;
}

async function fanOutMatchScore(client: PoolClient, envelope: TbaEnvelope): Promise<FanOutResult> {
  const result: FanOutResult = { notified: 0, pushed: 0, pruned: 0, orgs: 0 };
  const message = readMatchScore(envelope);
  if (!message.eventKey) return result;

  const orgs = await orgsAtEvent(client, message.eventKey);
  result.orgs = orgs.length;
  for (const org of orgs) {
    const ourKey = org.teamNumber ? teamKeyForNumber(org.teamNumber).toLowerCase() : null;
    const weWereIn =
      ourKey != null &&
      [...message.redTeams, ...message.blueTeams].some((key) => key.toLowerCase() === ourKey);
    // Only our own matches reach the leads; the whole event's scores would be noise.
    // Scouts who covered the match get it either way — it closes their loop.
    const scouts = message.matchKey ? await scoutsForMatch(client, org.orgId, message.matchKey) : [];
    const recipients = new Set(scouts.map((scout) => scout.userId));
    if (weWereIn) for (const userId of await orgLeadUserIds(client, org.orgId)) recipients.add(userId);
    if (recipients.size === 0) continue;

    mergeInto(
      result,
      await deliver(client, {
        orgId: org.orgId,
        userIds: [...recipients],
        type: "match_alert",
        content: matchScoreNotification({ message, teamNumber: org.teamNumber }),
        payload: { matchKey: message.matchKey, eventKey: message.eventKey },
      }),
    );
  }
  return result;
}

async function fanOutScheduleUpdated(
  client: PoolClient,
  envelope: TbaEnvelope,
): Promise<FanOutResult> {
  const result: FanOutResult = { notified: 0, pushed: 0, pruned: 0, orgs: 0 };
  const eventKey = eventKeyForMessage(envelope);
  if (!eventKey) return result;
  const orgs = await orgsAtEvent(client, eventKey);
  result.orgs = orgs.length;
  const content = scheduleUpdatedNotification({
    eventKey,
    eventName: readEventName(envelope),
    firstMatchSeconds: readFirstMatchSeconds(envelope),
  });
  for (const org of orgs) {
    const leads = await orgLeadUserIds(client, org.orgId);
    if (leads.length === 0) continue;
    mergeInto(
      result,
      await deliver(client, {
        orgId: org.orgId,
        userIds: leads,
        type: "match_alert",
        content,
        payload: { eventKey },
      }),
    );
  }
  return result;
}

async function fanOutAllianceSelection(
  client: PoolClient,
  envelope: TbaEnvelope,
): Promise<FanOutResult> {
  const result: FanOutResult = { notified: 0, pushed: 0, pruned: 0, orgs: 0 };
  const eventKey = eventKeyForMessage(envelope);
  if (!eventKey) return result;
  const orgs = await orgsAtEvent(client, eventKey);
  result.orgs = orgs.length;
  const content = allianceSelectionNotification({
    eventKey,
    eventName: readEventName(envelope),
    allianceCount: readAllianceCount(envelope),
  });
  for (const org of orgs) {
    const leads = await orgLeadUserIds(client, org.orgId);
    if (leads.length === 0) continue;
    mergeInto(
      result,
      await deliver(client, {
        orgId: org.orgId,
        userIds: leads,
        type: "match_alert",
        content,
        payload: { eventKey },
      }),
    );
  }
  return result;
}

/** Route one recorded delivery to the right fan-out. Unknown types are a no-op, not an error. */
export async function fanOutTbaEvent(
  client: PoolClient,
  row: Pick<TbaEventRow, "messageType" | "messageData">,
  now = new Date(),
): Promise<FanOutResult> {
  const envelope: TbaEnvelope = { messageType: row.messageType, messageData: row.messageData };
  if (!isActionableMessageType(envelope.messageType)) {
    return { notified: 0, pushed: 0, pruned: 0, orgs: 0 };
  }
  switch (envelope.messageType) {
    case "upcoming_match":
      return fanOutUpcomingMatch(client, envelope, now);
    case "match_score":
      return fanOutMatchScore(client, envelope);
    case "schedule_updated":
      return fanOutScheduleUpdated(client, envelope);
    case "alliance_selection":
      return fanOutAllianceSelection(client, envelope);
    default:
      return { notified: 0, pushed: 0, pruned: 0, orgs: 0 };
  }
}

async function markProcessed(
  client: PoolClient,
  id: string,
  notified: number,
): Promise<void> {
  await client.query(
    `UPDATE tba_webhook_events
        SET processed_at = now(), notified_count = $2::int, last_error = NULL
      WHERE id = $1::uuid`,
    [id, notified],
  );
}

async function markFailed(client: PoolClient, id: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : "TBA fan-out failed";
  await client.query(
    `UPDATE tba_webhook_events
        SET last_error = $2::text,
            processed_at = CASE WHEN attempts >= $3::int THEN now() ELSE NULL END
      WHERE id = $1::uuid`,
    [id, message.slice(0, 500), MAX_TBA_EVENT_ATTEMPTS],
  );
}

/**
 * Claim one pending row for this pass. `FOR UPDATE SKIP LOCKED` keeps the drain and the
 * post-response processing from doing the same event twice.
 */
async function claimOne(client: PoolClient, id?: string): Promise<TbaEventRow | null> {
  const result = await client.query<{
    id: string;
    messageType: string;
    messageData: Record<string, unknown>;
    attempts: number;
  }>(
    `UPDATE tba_webhook_events SET attempts = attempts + 1
      WHERE id = (
        SELECT id FROM tba_webhook_events
         WHERE processed_at IS NULL
           AND attempts < $2::int
           AND ($1::uuid IS NULL OR id = $1::uuid)
         ORDER BY received_at
         LIMIT 1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING id, message_type AS "messageType", message_data AS "messageData", attempts`,
    [id ?? null, MAX_TBA_EVENT_ATTEMPTS],
  );
  return result.rows[0] ?? null;
}

async function processClaimed(client: PoolClient, row: TbaEventRow, now: Date) {
  try {
    const result = await fanOutTbaEvent(client, row, now);
    await markProcessed(client, row.id, result.notified);
    return { ok: true as const, result };
  } catch (error) {
    await markFailed(client, row.id, error);
    return {
      ok: false as const,
      error: `${row.messageType} ${describeMatchKey(matchKeyForMessage({ messageType: row.messageType, messageData: row.messageData }))}: ${
        error instanceof Error ? error.message : "fan-out failed"
      }`,
    };
  }
}

/**
 * Process up to `limit` pending deliveries. Used both right after the webhook responds
 * (limit 1, the row we just wrote) and by the cron drain (catch-up).
 */
export async function drainTbaWebhookEvents(
  options: { limit?: number; id?: string; now?: Date } = {},
): Promise<DrainSummary> {
  const limit = Math.min(Math.max(options.limit ?? 25, 1), 200);
  const now = options.now ?? new Date();
  const summary: DrainSummary = { claimed: 0, processed: 0, notified: 0, pushed: 0, errors: [] };

  await withWebhookWorker(async (client) => {
    for (let index = 0; index < limit; index += 1) {
      const row = await claimOne(client, options.id);
      if (!row) break;
      summary.claimed += 1;
      const outcome = await processClaimed(client, row, now);
      if (outcome.ok) {
        summary.processed += 1;
        summary.notified += outcome.result.notified;
        summary.pushed += outcome.result.pushed;
      } else {
        summary.errors.push(outcome.error);
      }
      // A single-row claim (post-response path) is done after one pass.
      if (options.id) break;
    }
  });

  return summary;
}
