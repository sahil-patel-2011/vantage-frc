/**
 * Season-roadmap server logic: org resolution, stored progress, and the kickoff date.
 *
 * The roadmap CONTENT is code (season-roadmap.ts). This file only fetches what is
 * genuinely per-team — the kickoff date the team typed, the rookie filter, and which
 * tasks they have ticked — and hands it to the pure `buildRoadmap`.
 *
 * Honesty rules this file keeps:
 *   - No kickoff date stored => no dates rendered. We never guess "the first Saturday
 *     in January" and present it as this team's kickoff.
 *   - Rookie-ness comes from teams_ref.rookie_year when we have it, from the team's own
 *     stored preference when they set one, and is otherwise UNKNOWN — the page then
 *     offers a toggle rather than inferring it from anything else.
 *   - Every table read is guarded with to_regclass, so a database without migration 0459
 *     produces a "configure this" state instead of a 500.
 */
import type { PoolClient } from "@neondatabase/serverless";
import {
  KICKOFF_ACCURACY_NOTE,
  buildRoadmap,
  isRookieByYear,
  isTaskStatus,
  parseIsoDate,
  seasonYearForKickoff,
  taskById,
  type SeasonRoadmapView,
  type TaskProgress,
  type TaskStatus,
} from "./season-roadmap";

export type RoadmapSetupStep = { id: string; label: string; detail: string; href: string };

export type RoadmapView =
  | { status: "setup_required"; message: string; steps: RoadmapSetupStep[]; orgId: string | null }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      /** True/false from teams_ref.rookie_year; null when we simply do not know. */
      rookieKnown: boolean | null;
      /** What the team explicitly chose, if anything. */
      rookiePreference: boolean | null;
      seasonYear: number;
      canEditKickoff: boolean;
      roadmap: SeasonRoadmapView;
      computedAt: string;
    };

const SETUP_STEPS: RoadmapSetupStep[] = [
  {
    id: "workspace",
    label: "Select a team",
    detail: "The roadmap tracks your team's progress, so it needs to know which team you are on.",
    href: "/workspace",
  },
];

export function setupRequired(
  orgId: string | null = null,
  message = "Choose a team to open your team's season roadmap.",
): Extract<RoadmapView, { status: "setup_required" }> {
  return { status: "setup_required", message, steps: SETUP_STEPS, orgId };
}

export type ResolvedOrg = { orgId: string; teamNumber: number | null; role: string };

export async function resolveOrg(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
): Promise<ResolvedOrg | null> {
  const result = await client.query<ResolvedOrg>(
    `SELECT m.org_id::text AS "orgId", o.team_number AS "teamNumber", m.role::text AS role
     FROM memberships m
     JOIN organizations o ON o.id = m.org_id
     WHERE m.user_id = $1::uuid
       AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
     ORDER BY CASE m.role::text WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
     LIMIT 1`,
    [userId, requestedOrg],
  );
  return result.rows[0] ?? null;
}

const OPTIONAL_TABLES = ["season_roadmap_progress", "season_roadmap_settings", "teams_ref"] as const;
type OptionalTable = (typeof OPTIONAL_TABLES)[number];

export async function presentTables(client: PoolClient): Promise<Set<OptionalTable>> {
  const result = await client.query<{ name: OptionalTable }>(
    `SELECT t.name FROM unnest($1::text[]) AS t(name)
     WHERE to_regclass('public.' || t.name) IS NOT NULL`,
    [[...OPTIONAL_TABLES]],
  );
  return new Set(result.rows.map((row) => row.name));
}

function isoDateOrNull(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string") return parseIsoDate(value.slice(0, 10)) == null ? null : value.slice(0, 10);
  return null;
}

function isoOrNull(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return null;
}

export type StoredSettings = { kickoffDate: string | null; rookieOnly: boolean | null };

export async function loadSettings(
  client: PoolClient,
  orgId: string,
  present: Set<OptionalTable>,
): Promise<StoredSettings> {
  if (!present.has("season_roadmap_settings")) return { kickoffDate: null, rookieOnly: null };
  const result = await client.query<{ kickoffDate: unknown; rookieOnly: boolean | null }>(
    `SELECT kickoff_date AS "kickoffDate", rookie_only AS "rookieOnly"
     FROM season_roadmap_settings WHERE org_id = $1::uuid`,
    [orgId],
  );
  const row = result.rows[0];
  return {
    kickoffDate: isoDateOrNull(row?.kickoffDate),
    rookieOnly: typeof row?.rookieOnly === "boolean" ? row.rookieOnly : null,
  };
}

export async function loadProgress(
  client: PoolClient,
  orgId: string,
  present: Set<OptionalTable>,
): Promise<TaskProgress[]> {
  if (!present.has("season_roadmap_progress")) return [];
  const result = await client.query<{
    taskId: string;
    status: string;
    note: string | null;
    completedByName: string | null;
    completedAt: unknown;
  }>(
    `SELECT p.task_id AS "taskId", p.status, p.note,
            u.name AS "completedByName", p.completed_at AS "completedAt"
     FROM season_roadmap_progress p
     LEFT JOIN users u ON u.id = p.completed_by
     WHERE p.org_id = $1::uuid`,
    [orgId],
  );
  const out: TaskProgress[] = [];
  for (const row of result.rows) {
    // A task id we no longer ship is dropped rather than rendered as an orphan.
    if (!taskById(row.taskId) || !isTaskStatus(row.status)) continue;
    out.push({
      taskId: row.taskId,
      status: row.status,
      note: row.note ?? null,
      completedByName: row.completedByName ?? null,
      completedAt: isoOrNull(row.completedAt),
    });
  }
  return out;
}

/** teams_ref.rookie_year for this org's team number, when the reference table has it. */
export async function loadRookieYear(
  client: PoolClient,
  teamNumber: number | null,
  present: Set<OptionalTable>,
): Promise<number | null> {
  if (teamNumber == null || !present.has("teams_ref")) return null;
  const result = await client.query<{ rookieYear: number | null }>(
    `SELECT rookie_year AS "rookieYear" FROM teams_ref WHERE team_number = $1::int`,
    [teamNumber],
  );
  return result.rows[0]?.rookieYear ?? null;
}

export type ComputeInput = {
  userId: string;
  requestedOrg: string | null;
  /** ISO date for "today". Supplied by the route so this stays testable. */
  today: string;
  /** Override the stored rookie filter for this render only (the page's toggle). */
  rookieOverride?: boolean | null;
};

export async function computeRoadmapView(
  client: PoolClient,
  input: ComputeInput,
): Promise<RoadmapView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  if (!org) return setupRequired(input.requestedOrg);

  const present = await presentTables(client);
  const [settings, progress, rookieYear] = await Promise.all([
    loadSettings(client, org.orgId, present),
    loadProgress(client, org.orgId, present),
    loadRookieYear(client, org.teamNumber, present),
  ]);

  const seasonYear = seasonYearForKickoff(settings.kickoffDate, input.today);
  const rookieKnown = isRookieByYear(rookieYear, seasonYear);

  // Precedence: this render's toggle, then the team's stored choice, then what the
  // reference data says, then "show everything" — never a guess dressed as a fact.
  const rookieOnly =
    input.rookieOverride ?? settings.rookieOnly ?? rookieKnown ?? false;

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    rookieKnown,
    rookiePreference: settings.rookieOnly,
    seasonYear,
    canEditKickoff: true,
    roadmap: buildRoadmap({
      kickoffDate: settings.kickoffDate,
      today: input.today,
      rookieOnly,
      progress,
    }),
    computedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export class RoadmapNotConfiguredError extends Error {
  constructor() {
    super("season_roadmap tables are not present in this database");
    this.name = "RoadmapNotConfiguredError";
  }
}

export async function saveSettings(
  client: PoolClient,
  input: { orgId: string; userId: string; kickoffDate: string | null; rookieOnly: boolean | null },
): Promise<void> {
  const present = await presentTables(client);
  if (!present.has("season_roadmap_settings")) throw new RoadmapNotConfiguredError();
  await client.query(
    `INSERT INTO season_roadmap_settings (org_id, kickoff_date, rookie_only, updated_by, updated_at)
     VALUES ($1::uuid, $2::date, $3::boolean, $4::uuid, now())
     ON CONFLICT (org_id) DO UPDATE
       SET kickoff_date = EXCLUDED.kickoff_date,
           rookie_only = EXCLUDED.rookie_only,
           updated_by = EXCLUDED.updated_by,
           updated_at = now()`,
    [input.orgId, input.kickoffDate, input.rookieOnly, input.userId],
  );
}

export async function saveTaskStatus(
  client: PoolClient,
  input: { orgId: string; userId: string; taskId: string; status: TaskStatus; note: string | null },
): Promise<void> {
  const present = await presentTables(client);
  if (!present.has("season_roadmap_progress")) throw new RoadmapNotConfiguredError();
  // completed_at is only meaningful for 'done' — the table's CHECK enforces the same rule.
  await client.query(
    `INSERT INTO season_roadmap_progress (org_id, task_id, status, completed_by, completed_at, note)
     VALUES ($1::uuid, $2::text, $3::text, $4::uuid,
             CASE WHEN $3::text = 'done' THEN now() ELSE NULL END, $5::text)
     ON CONFLICT (org_id, task_id) DO UPDATE
       SET status = EXCLUDED.status,
           completed_by = CASE WHEN EXCLUDED.status = 'done' THEN EXCLUDED.completed_by
                               ELSE season_roadmap_progress.completed_by END,
           completed_at = CASE WHEN EXCLUDED.status = 'done' THEN now() ELSE NULL END,
           note = EXCLUDED.note,
           updated_at = now()`,
    [input.orgId, input.taskId, input.status, input.userId, input.note],
  );
}

export const ROADMAP_ACCURACY_NOTE = KICKOFF_ACCURACY_NOTE;
