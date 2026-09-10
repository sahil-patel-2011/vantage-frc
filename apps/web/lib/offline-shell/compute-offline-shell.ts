import type { PoolClient } from "@neondatabase/serverless";
import { computeOfflineShellReadiness, summarizeOfflineShell } from ".";
import type {
  OfflineShellEvent,
  OfflineShellNetworkStatus,
  OfflineShellReadiness,
  OfflineShellSummary,
} from "./types";

export type OfflineShellSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type OfflineShellView =
  | {
      status: "setup_required";
      message: string;
      steps: OfflineShellSetupStep[];
      orgId: string | null;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      events: OfflineShellEvent[];
      summary: OfflineShellSummary;
      readiness: OfflineShellReadiness;
      computedAt: string;
    };

type EventRow = {
  id: string;
  deviceLabel: string;
  routes: string[] | null;
  routeCount: number;
  cacheBytes: string | number;
  networkStatus: OfflineShellNetworkStatus;
  notes: string | null;
  occurredAt: string;
};

function mapEvent(row: EventRow): OfflineShellEvent {
  return {
    id: row.id,
    deviceLabel: row.deviceLabel,
    routes: Array.isArray(row.routes) ? row.routes : [],
    routeCount: Number(row.routeCount) || 0,
    cacheBytes: Number(row.cacheBytes) || 0,
    networkStatus: row.networkStatus,
    notes: row.notes,
    occurredAt: row.occurredAt,
  };
}

async function resolveOrg(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
): Promise<{ orgId: string; teamNumber: number | null } | null> {
  const membership = await client.query<{ orgId: string; teamNumber: number | null }>(
    `SELECT m.org_id AS "orgId", o.team_number AS "teamNumber"
     FROM memberships m
     JOIN organizations o ON o.id = m.org_id
     WHERE m.user_id = $1
       AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
     LIMIT 1`,
    [userId, requestedOrg],
  );
  return membership.rows[0] ?? null;
}

export async function computeOfflineShellView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null },
): Promise<OfflineShellView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);

  if (!org) {
    return {
      status: "setup_required",
      message: "Choose a team to see whether Scouting stays on this phone.",
      steps: [
        { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
      ],
      orgId: null,
    };
  }

  const eventResult = await client.query<EventRow>(
    `SELECT id, device_label AS "deviceLabel", routes, route_count AS "routeCount",
            cache_bytes AS "cacheBytes", network_status AS "networkStatus", notes,
            occurred_at::text AS "occurredAt"
     FROM offline_shell_cache_events
     WHERE org_id = $1
     ORDER BY occurred_at DESC
     LIMIT 200`,
    [org.orgId],
  );

  const events = eventResult.rows.map(mapEvent);
  const summary = summarizeOfflineShell(events);
  const readiness = computeOfflineShellReadiness(summary);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    events,
    summary,
    readiness,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function logCacheEvent(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    deviceLabel: string;
    routes: string[];
    cacheBytes: number;
    networkStatus: OfflineShellNetworkStatus;
    notes: string | null;
  },
): Promise<void> {
  const routes = [...new Set(input.routes)];
  await client.query(
    `INSERT INTO offline_shell_cache_events (
       org_id, device_label, routes, route_count, cache_bytes, network_status, notes, logged_by
     ) VALUES ($1,$2,$3::text[],$4,$5,$6,$7,$8)`,
    [
      input.orgId,
      input.deviceLabel,
      routes,
      routes.length,
      Math.max(0, Math.round(input.cacheBytes)),
      input.networkStatus,
      input.notes,
      input.userId,
    ],
  );
}

export async function deleteCacheEvent(
  client: PoolClient,
  input: { orgId: string; eventId: string },
): Promise<void> {
  await client.query(`DELETE FROM offline_shell_cache_events WHERE id = $1 AND org_id = $2`, [
    input.eventId,
    input.orgId,
  ]);
}
