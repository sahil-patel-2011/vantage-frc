import type { PoolClient } from "@neondatabase/serverless";
import { evaluateIncident, summarizeIncidents } from ".";
import type {
  Incident,
  IncidentCategory,
  IncidentEvaluation,
  IncidentSeverity,
  IncidentStatus,
  IncidentsSummary,
} from "./types";

export const INCIDENT_CATEGORIES: IncidentCategory[] = [
  "injury",
  "near_miss",
  "equipment",
  "electrical",
  "chemical",
  "property",
  "other",
];
export const INCIDENT_SEVERITIES: IncidentSeverity[] = ["minor", "moderate", "serious", "critical"];
export const INCIDENT_STATUSES: IncidentStatus[] = ["open", "investigating", "action_pending", "resolved", "closed"];

export type IncidentsSetupStep = { id: string; label: string; detail: string; href: string };

export type IncidentsView =
  | {
      status: "setup_required";
      message: string;
      steps: IncidentsSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      evaluations: IncidentEvaluation[];
      summary: IncidentsSummary;
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

type IncidentRow = {
  id: string;
  title: string;
  category: IncidentCategory;
  severity: IncidentSeverity;
  occurredOn: string;
  location: string | null;
  description: string | null;
  correctiveAction: string | null;
  status: IncidentStatus;
  owner: string | null;
  dueOn: string | null;
  notes: string | null;
  seasonYear: number;
  createdAt: string;
};

function mapIncident(row: IncidentRow): Incident {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    severity: row.severity,
    occurredOn: row.occurredOn,
    location: row.location,
    description: row.description,
    correctiveAction: row.correctiveAction,
    status: row.status,
    owner: row.owner,
    dueOn: row.dueOn,
    notes: row.notes,
    seasonYear: row.seasonYear,
    createdAt: row.createdAt,
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

export async function computeIncidentsView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<IncidentsView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Choose your team to keep a safety incident log.",
      steps: [
        { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" },
      ],
      orgId: null,
      seasonYear,
    };
  }

  const [incidentResult, seasonResult] = await Promise.all([
    client.query<IncidentRow>(
      `SELECT id, title, category, severity, occurred_on::text AS "occurredOn", location, description,
              corrective_action AS "correctiveAction", status, owner, due_on::text AS "dueOn",
              notes, season_year AS "seasonYear", created_at::text AS "createdAt"
       FROM incident_reports
       WHERE org_id = $1 AND season_year = $2
       ORDER BY occurred_on DESC, created_at DESC`,
      [org.orgId, seasonYear],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM incident_reports WHERE org_id = $1 ORDER BY season_year DESC`,
      [org.orgId],
    ),
  ]);

  const incidents = incidentResult.rows.map(mapIncident);
  const evaluations = incidents.map((incident) => evaluateIncident(incident));
  const summary = summarizeIncidents(incidents);
  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    evaluations,
    summary,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function createIncident(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    seasonYear: number;
    title: string;
    category: IncidentCategory;
    severity: IncidentSeverity;
    occurredOn: string;
    location: string | null;
    description: string | null;
    correctiveAction: string | null;
    owner: string | null;
    dueOn: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO incident_reports
       (org_id, season_year, title, category, severity, occurred_on, location, description,
        corrective_action, status, owner, due_on, created_by)
     VALUES ($1,$2,$3,$4,$5,$6::date,$7,$8,$9,'open',$10,$11::date,$12)`,
    [
      input.orgId,
      input.seasonYear,
      input.title,
      input.category,
      input.severity,
      input.occurredOn,
      input.location,
      input.description,
      input.correctiveAction,
      input.owner,
      input.dueOn,
      input.userId,
    ],
  );
}

export async function updateIncident(
  client: PoolClient,
  input: {
    orgId: string;
    incidentId: string;
    title?: string;
    category?: IncidentCategory;
    severity?: IncidentSeverity;
    status?: IncidentStatus;
    location?: string | null;
    description?: string | null;
    correctiveAction?: string | null;
    owner?: string | null;
    dueOn?: string | null;
    occurredOn?: string;
  },
): Promise<void> {
  await client.query(
    `UPDATE incident_reports SET
       title = COALESCE($3, title),
       category = COALESCE($4, category),
       severity = COALESCE($5, severity),
       status = COALESCE($6, status),
       occurred_on = COALESCE($7::date, occurred_on),
       location = CASE WHEN $8::boolean THEN $9 ELSE location END,
       description = CASE WHEN $10::boolean THEN $11 ELSE description END,
       corrective_action = CASE WHEN $12::boolean THEN $13 ELSE corrective_action END,
       owner = CASE WHEN $14::boolean THEN $15 ELSE owner END,
       due_on = CASE WHEN $16::boolean THEN $17::date ELSE due_on END,
       updated_at = now()
     WHERE id = $1 AND org_id = $2`,
    [
      input.incidentId,
      input.orgId,
      input.title ?? null,
      input.category ?? null,
      input.severity ?? null,
      input.status ?? null,
      input.occurredOn ?? null,
      input.location !== undefined,
      input.location ?? null,
      input.description !== undefined,
      input.description ?? null,
      input.correctiveAction !== undefined,
      input.correctiveAction ?? null,
      input.owner !== undefined,
      input.owner ?? null,
      input.dueOn !== undefined,
      input.dueOn ?? null,
    ],
  );
}

export async function deleteIncident(
  client: PoolClient,
  input: { orgId: string; incidentId: string },
): Promise<void> {
  await client.query(`DELETE FROM incident_reports WHERE id = $1 AND org_id = $2`, [input.incidentId, input.orgId]);
}
