import type { PoolClient } from "@neondatabase/serverless";
import { withRls } from "@vantage/db";
import { eventReferenceIsFresh, isTbaEventKey } from "@vantage/reference";
import { after } from "next/server";
import { runOnDemandEventRefresh } from "./run-ingest";

const inflight = new Map<string, Promise<void>>();

export type EventCacheFreshness = {
  matchCount: number;
  matchSyncedAt: string | null;
  epaCount: number;
  epaSyncedAt: string | null;
};

export async function readEventCacheFreshness(
  client: PoolClient,
  eventKey: string,
): Promise<EventCacheFreshness> {
  const result = await client.query<EventCacheFreshness>(
    `SELECT
       (SELECT COUNT(*)::int FROM matches_ref WHERE event_key = $1) AS "matchCount",
       (SELECT MAX(synced_at)::text FROM matches_ref WHERE event_key = $1) AS "matchSyncedAt",
       (SELECT COUNT(*)::int FROM team_event_metrics WHERE event_key = $1 AND source = 'statbotics') AS "epaCount",
       (SELECT MAX(synced_at)::text FROM team_event_metrics WHERE event_key = $1 AND source = 'statbotics') AS "epaSyncedAt"`,
    [eventKey],
  );
  return (
    result.rows[0] ?? {
      matchCount: 0,
      matchSyncedAt: null,
      epaCount: 0,
      epaSyncedAt: null,
    }
  );
}

/**
 * If Neon already has this event's TBA matches + Statbotics EPA, skip upstream.
 * Otherwise pull once (TBA key + public Statbotics), upsert into Neon, and
 * let later product reads use the database.
 */
export async function hydrateOrgActiveEvent(input: {
  userId: string;
  requestedOrg?: string | null;
}): Promise<{ orgId: string | null; eventKey: string | null; fetched: boolean }> {
  const peek = await withRls({ userId: input.userId }, async (client) => {
    const membership = await client.query<{ orgId: string; eventKey: string | null }>(
      `SELECT m.org_id AS "orgId", c.active_event_key AS "eventKey"
       FROM memberships m
       JOIN organizations o ON o.id = m.org_id
       LEFT JOIN org_active_context c ON c.org_id = o.id
       WHERE m.user_id = $1 AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
       ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
       LIMIT 1`,
      [input.userId, input.requestedOrg ?? null],
    );
    const row = membership.rows[0];
    if (!row?.orgId || !isTbaEventKey(row.eventKey)) {
      return { orgId: row?.orgId ?? null, eventKey: row?.eventKey ?? null, needsFetch: false };
    }
    const freshness = await readEventCacheFreshness(client, row.eventKey!);
    return {
      orgId: row.orgId,
      eventKey: row.eventKey,
      needsFetch: !eventReferenceIsFresh(freshness),
      hasCachedMatches: freshness.matchCount > 0,
    };
  });

  const plan = refreshPlan(peek);
  if (plan === "none" || !peek.eventKey || !peek.orgId) {
    return { orgId: peek.orgId, eventKey: peek.eventKey, fetched: false };
  }

  const eventKey = peek.eventKey;
  const orgId = peek.orgId;
  if (plan === "background") {
    // The page already has this event's matches, just not the last two minutes of them:
    // answer now from the cache and refresh after the response, so nobody waits on TBA.
    try {
      after(() => refreshEventOnce(eventKey, orgId));
      return { orgId, eventKey, fetched: false };
    } catch {
      // Outside a request (a script or test): fall through and refresh inline.
    }
  }
  await refreshEventOnce(eventKey, orgId);
  return { orgId, eventKey, fetched: true };
}

/**
 * none: the cache is fresh. background: stale but present — serve it, refresh afterwards.
 * blocking: nothing cached yet, so the page has nothing to show until the refresh lands.
 */
export function refreshPlan(input: { needsFetch: boolean; hasCachedMatches?: boolean }): "none" | "background" | "blocking" {
  if (!input.needsFetch) return "none";
  return input.hasCachedMatches ? "background" : "blocking";
}

/** One refresh per event per instance at a time; runOnDemandEventRefresh adds the cross-instance claim. */
async function refreshEventOnce(eventKey: string, orgId: string): Promise<void> {
  const existing = inflight.get(eventKey);
  if (existing) {
    await existing;
    return;
  }
  const pending = runOnDemandEventRefresh(eventKey, { preferOrgIds: [orgId] })
    .then(() => undefined)
    .catch(() => undefined)
    .finally(() => {
      inflight.delete(eventKey);
    });
  inflight.set(eventKey, pending);
  await pending;
}
