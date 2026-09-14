import type { PoolClient } from "@neondatabase/serverless";
import { clusterFailureEvents, FAILURE_PATTERN_NOTE_STATUSES, summarizeClusters } from ".";
import type {
  FailurePatternCluster,
  FailurePatternEvent,
  FailurePatternNote,
  FailurePatternNoteStatus,
  FailurePatternSummary,
} from "./types";

export { FAILURE_PATTERN_NOTE_STATUSES };

export type FailurePatternsSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type FailurePatternsView =
  | {
      status: "setup_required";
      message: string;
      steps: FailurePatternsSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      clusters: FailurePatternCluster[];
      summary: FailurePatternSummary;
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

function isNoteStatus(value: unknown): value is FailurePatternNoteStatus {
  return typeof value === "string" && (FAILURE_PATTERN_NOTE_STATUSES as readonly string[]).includes(value);
}

type FmeaEventRow = {
  id: string;
  subsystemName: string;
  title: string;
  occurredOn: string;
  severity: number | null;
  status: string;
};

type IncidentEventRow = {
  id: string;
  title: string;
  description: string | null;
  occurredOn: string;
  severityLabel: string | null;
  status: string;
};

const INCIDENT_SEVERITY_SCORE: Record<string, number> = {
  minor: 2,
  moderate: 5,
  serious: 7,
  critical: 10,
};

type NoteRow = {
  id: string;
  subsystemName: string;
  status: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
};

function mapNote(row: NoteRow): FailurePatternNote {
  return {
    id: row.id,
    subsystemName: row.subsystemName,
    status: isNoteStatus(row.status) ? row.status : "open",
    note: row.note,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
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

export async function computeFailurePatternsView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<FailurePatternsView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Choose your team to detect repeat-failure patterns.",
      steps: [
        { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" },
      ],
      orgId: null,
      seasonYear,
    };
  }

  const [fmeaResult, incidentResult, subsystemResult, noteResult, seasonResult] = await Promise.all([
    client.query<FmeaEventRow>(
      `SELECT id, subsystem_name AS "subsystemName", title, occurred_at::text AS "occurredOn",
              severity, status
       FROM fmea_failures
       WHERE org_id = $1 AND season_year = $2
       ORDER BY occurred_at DESC
       LIMIT 500`,
      [org.orgId, seasonYear],
    ),
    client.query<IncidentEventRow>(
      `SELECT id, title, description, occurred_on::text AS "occurredOn", severity AS "severityLabel", status
       FROM incident_reports
       WHERE org_id = $1 AND season_year = $2 AND category = 'equipment'
       ORDER BY occurred_on DESC
       LIMIT 500`,
      [org.orgId, seasonYear],
    ),
    client.query<{ name: string }>(
      `SELECT DISTINCT name FROM robot_subsystems WHERE org_id = $1 AND season_year = $2`,
      [org.orgId, seasonYear],
    ),
    client.query<NoteRow>(
      `SELECT DISTINCT ON (subsystem_name) id, subsystem_name AS "subsystemName", status, note,
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM failure_patterns_notes
       WHERE org_id = $1 AND season_year = $2
       ORDER BY subsystem_name, created_at DESC`,
      [org.orgId, seasonYear],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM fmea_failures WHERE org_id = $1
       UNION
       SELECT DISTINCT season_year AS "seasonYear" FROM incident_reports WHERE org_id = $1
       ORDER BY "seasonYear" DESC`,
      [org.orgId],
    ),
  ]);

  // Incident reports don't carry a subsystem column, so equipment-category incidents are matched
  // against this org's declared robot_subsystems names (whole-word, case-insensitive) in the
  // title or description. Incidents that don't clearly name a known subsystem are skipped rather
  // than guessed at.
  const subsystemNames = subsystemResult.rows.map((r) => r.name).filter((name) => name && name.trim());

  const events: FailurePatternEvent[] = [
    ...fmeaResult.rows
      .filter((row) => row.subsystemName && row.subsystemName.trim())
      .map(
        (row): FailurePatternEvent => ({
          id: row.id,
          source: "fmea",
          subsystemName: row.subsystemName.trim(),
          title: row.title,
          occurredOn: row.occurredOn,
          severity: row.severity == null ? null : Number(row.severity) || null,
          status: row.status,
        }),
      ),
  ];

  for (const row of incidentResult.rows) {
    const haystack = `${row.title} ${row.description ?? ""}`.toLowerCase();
    const subsystemName = subsystemNames.find((name) => {
      const escaped = name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`\\b${escaped.toLowerCase()}\\b`).test(haystack);
    });
    if (!subsystemName) continue;
    events.push({
      id: row.id,
      source: "incident",
      subsystemName: subsystemName.trim(),
      title: row.title,
      occurredOn: row.occurredOn,
      severity: row.severityLabel ? INCIDENT_SEVERITY_SCORE[row.severityLabel] ?? null : null,
      status: row.status,
    });
  }

  const notesBySubsystem = new Map(noteResult.rows.map((row) => [row.subsystemName, mapNote(row)]));
  const clusters = clusterFailureEvents(events, notesBySubsystem);
  const summary = summarizeClusters(clusters);

  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    clusters,
    summary,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function logPatternNote(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    seasonYear: number;
    subsystemName: string;
    status: FailurePatternNoteStatus;
    note: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO failure_patterns_notes (org_id, season_year, subsystem_name, status, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [input.orgId, input.seasonYear, input.subsystemName, input.status, input.note, input.userId],
  );
}

export async function deletePatternNote(
  client: PoolClient,
  input: { orgId: string; noteId: string },
): Promise<void> {
  await client.query(`DELETE FROM failure_patterns_notes WHERE id = $1 AND org_id = $2`, [
    input.noteId,
    input.orgId,
  ]);
}
