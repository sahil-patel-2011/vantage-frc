import type { PoolClient } from "@neondatabase/serverless";
import { summarizeIncidentHeatmap } from ".";
import type { Incident, IncidentContext, IncidentHeatmapSummary } from "./types";

export const INCIDENT_CONTEXTS: IncidentContext[] = ["match", "pit", "practice", "inspection", "other"];

export type IncidentHeatmapSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type IncidentHeatmapView =
  | {
      status: "setup_required";
      message: string;
      steps: IncidentHeatmapSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      incidents: Incident[];
      summary: IncidentHeatmapSummary;
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

type IncidentRow = {
  id: string;
  seasonYear: number;
  subsystem: string;
  context: IncidentContext;
  eventKey: string | null;
  matchKey: string | null;
  title: string;
  notes: string | null;
  occurredAt: string;
};

function mapIncident(row: IncidentRow): Incident {
  return {
    id: row.id,
    seasonYear: row.seasonYear,
    subsystem: row.subsystem,
    context: row.context,
    eventKey: row.eventKey,
    matchKey: row.matchKey,
    title: row.title,
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

export async function computeIncidentHeatmapView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<IncidentHeatmapView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Choose your team to log and view incidents.",
      steps: [
        { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" },
      ],
      orgId: null,
      seasonYear,
    };
  }

  const [incidentResult, seasonResult] = await Promise.all([
    client.query<IncidentRow>(
      `SELECT id, season_year AS "seasonYear", subsystem, context, event_key AS "eventKey",
              match_key AS "matchKey", title, notes, occurred_at::text AS "occurredAt"
       FROM incident_heatmap_incidents
       WHERE org_id = $1 AND season_year = $2
       ORDER BY occurred_at DESC`,
      [org.orgId, seasonYear],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM incident_heatmap_incidents WHERE org_id = $1 ORDER BY season_year DESC`,
      [org.orgId],
    ),
  ]);

  const incidents = incidentResult.rows.map(mapIncident);
  const summary = summarizeIncidentHeatmap(incidents);
  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    incidents,
    summary,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function logIncident(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    subsystem: string;
    context: IncidentContext;
    eventKey: string | null;
    matchKey: string | null;
    title: string;
    notes: string | null;
    occurredAt: string;
    seasonYear: number;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO incident_heatmap_incidents (
       org_id, season_year, subsystem, context, event_key, match_key, title, notes, occurred_at, logged_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz,$10)`,
    [
      input.orgId,
      input.seasonYear,
      input.subsystem,
      input.context,
      input.eventKey,
      input.matchKey,
      input.title,
      input.notes,
      input.occurredAt,
      input.userId,
    ],
  );
}

export async function deleteIncident(
  client: PoolClient,
  input: { orgId: string; incidentId: string },
): Promise<void> {
  await client.query(`DELETE FROM incident_heatmap_incidents WHERE id = $1 AND org_id = $2`, [
    input.incidentId,
    input.orgId,
  ]);
}
