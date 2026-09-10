import type { PoolClient } from "@neondatabase/serverless";
import { groupIntoTimelines, MATCH_NOTE_CATEGORIES, MATCH_NOTE_PHASES, mergeTimelineEntries, summarizeMatchNotes, videoJobsToTimelineEntries } from ".";
import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";
import type {
  MatchNoteCategory,
  MatchNoteEntry,
  MatchNotePhase,
  MatchNotesTimelineSummary,
  MatchTimeline,
} from "./types";

export { MATCH_NOTE_CATEGORIES, MATCH_NOTE_PHASES };

export type MatchNotesTimelineSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type MatchNotesTimelineView =
  | {
      status: "setup_required";
      message: string;
      steps: MatchNotesTimelineSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      timelines: MatchTimeline[];
      summary: MatchNotesTimelineSummary;
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

type EntryRow = {
  id: string;
  matchLabel: string;
  matchKey: string | null;
  teamNumber: number | null;
  seasonYear: number;
  phase: MatchNotePhase;
  category: MatchNoteCategory;
  clockSeconds: number;
  note: string;
  createdAt: string;
};

function mapEntry(row: EntryRow): MatchNoteEntry {
  return {
    id: row.id,
    matchLabel: row.matchLabel,
    matchKey: row.matchKey,
    teamNumber: row.teamNumber == null ? null : Number(row.teamNumber),
    seasonYear: row.seasonYear,
    phase: row.phase,
    category: row.category,
    clockSeconds: Number(row.clockSeconds) || 0,
    note: row.note,
    createdAt: row.createdAt,
    source: "human",
    confidence: null,
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

function setupSteps(orgId: string | null): MatchNotesTimelineSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Select a team",
      detail: "Choose your team to open the match-note timeline.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "schedule",
      label: "Open Schedule",
      detail: "Match rows stay empty until real TBA/event data exists.",
      href: withOrgHref("/schedule", orgId),
    },
    {
      id: "strategy",
      label: "Open Strategy",
      detail: "Pick lists stay empty until real metrics exist.",
      href: hubHref("/competition", "strategy", orgId),
    },
    {
      id: "scouting",
      label: "Open Scouting",
      detail: "Scout rows stay blank until your team enters them.",
      href: hubHref("/competition", "scouting", orgId),
    },
  ];
}

function setupRequiredView(seasonYear: number, orgId: string | null = null): MatchNotesTimelineView {
  return {
    status: "setup_required",
    message: "Select a team to log in-match notes synced to the match clock.",
    steps: setupSteps(orgId),
    orgId,
    seasonYear,
  };
}

export async function computeMatchNotesTimelineView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<MatchNotesTimelineView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return setupRequiredView(seasonYear);
  }

  const [entryResult, seasonResult, videoResult] = await Promise.all([
    client.query<EntryRow>(
      `SELECT id, match_label AS "matchLabel", match_key AS "matchKey", team_number AS "teamNumber",
              season_year AS "seasonYear", phase, category, clock_seconds AS "clockSeconds", note,
              created_at::text AS "createdAt"
       FROM match_notes_timeline_entries
       WHERE org_id = $1 AND season_year = $2
       ORDER BY match_label, clock_seconds ASC`,
      [org.orgId, seasonYear],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM match_notes_timeline_entries WHERE org_id = $1 ORDER BY season_year DESC`,
      [org.orgId],
    ),
    client.query<{
      id: string;
      matchKey: string | null;
      createdAt: string;
      result: unknown;
    }>(
      `SELECT id,
              match_key AS "matchKey",
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt",
              result
       FROM video_analysis_jobs
       WHERE org_id = $1::uuid
         AND status = 'completed'
         AND COALESCE((checkpoint->>'confirmed')::boolean, false)
       ORDER BY created_at DESC
       LIMIT 50`,
      [org.orgId],
    ),
  ]);

  const human = entryResult.rows.map(mapEntry);
  const video = videoJobsToTimelineEntries(videoResult.rows).filter(
    (entry) => entry.seasonYear === seasonYear,
  );
  const entries = mergeTimelineEntries(human, video);
  const timelines = groupIntoTimelines(entries);
  const summary = summarizeMatchNotes(entries);
  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    timelines,
    summary,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function logMatchNote(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    matchLabel: string;
    matchKey: string | null;
    teamNumber: number | null;
    phase: MatchNotePhase;
    category: MatchNoteCategory;
    clockSeconds: number;
    note: string;
    seasonYear: number;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO match_notes_timeline_entries (
       org_id, match_label, match_key, team_number, season_year, phase, category, clock_seconds, note, logged_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      input.orgId,
      input.matchLabel,
      input.matchKey,
      input.teamNumber,
      input.seasonYear,
      input.phase,
      input.category,
      Math.max(0, Math.round(input.clockSeconds)),
      input.note,
      input.userId,
    ],
  );
}

export async function deleteMatchNote(
  client: PoolClient,
  input: { orgId: string; entryId: string },
): Promise<void> {
  await client.query(`DELETE FROM match_notes_timeline_entries WHERE id = $1 AND org_id = $2`, [
    input.entryId,
    input.orgId,
  ]);
}
