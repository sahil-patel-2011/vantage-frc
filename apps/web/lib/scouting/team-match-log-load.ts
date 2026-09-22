// Server half of team-match-log.ts.
//
// Request path only — PoolClient from the caller's withRls, org-scoped SQL on
// top of RLS, one query per source (entries, matches, formulas, notes, videos),
// all in parallel.

import type { PoolClient } from "@neondatabase/serverless";
import type { FormulaExpression } from "@vantage/scouting";
import {
  buildTeamMatchLog,
  type TeamLogEntryRow,
  type TeamLogMatchRow,
  type TeamLogNoteRow,
  type TeamLogVideoRow,
  type TeamMatchLog,
} from "./team-match-log";
import type { OrgValueFormula } from "./scouted-ratings";

export type TeamMatchLogView =
  | ({ status: "ready"; eventKey: string } & TeamMatchLog)
  | { status: "empty"; message: string };

const TEAM_KEY = /^frc\d{1,5}[A-H]?$/;

export async function loadTeamMatchLog(
  client: PoolClient,
  input: { orgId: string; eventKey: string | null; teamKey: string },
): Promise<TeamMatchLogView> {
  if (!input.eventKey) return { status: "empty", message: "Choose an event to see this robot match by match." };
  if (!TEAM_KEY.test(input.teamKey)) return { status: "empty", message: "That is not a team key." };
  const teamNumber = Number(input.teamKey.replace(/^frc/, "").replace(/[A-H]$/, ""));

  const [entries, matches, formulas, notes, videos] = await Promise.all([
    client.query<TeamLogEntryRow>(
      `SELECT e.match_key AS "matchKey", e.payload
         FROM match_scout_entries e
        WHERE e.org_id = $1::uuid AND e.event_key = $2::text AND e.team_key = $3::text
        ORDER BY e.match_key, e.created_at`,
      [input.orgId, input.eventKey, input.teamKey],
    ),
    client.query<TeamLogMatchRow>(
      `SELECT m.match_key AS "matchKey", m.comp_level AS "compLevel", m.set_number AS "setNumber",
              m.match_number AS "matchNumber", m.red_alliance AS "redAlliance", m.blue_alliance AS "blueAlliance",
              m.winning_alliance AS "winningAlliance",
              COALESCE(m.actual_time, m.predicted_time, m.event_time)::text AS "time",
              m.videos->0->>'type' AS "tbaVideoType", m.videos->0->>'key' AS "tbaVideoKey"
         FROM matches_ref m
        WHERE m.event_key = $1::text
          AND (   COALESCE(m.red_alliance->'teamKeys', m.red_alliance->'team_keys') ? $2::text
               OR COALESCE(m.blue_alliance->'teamKeys', m.blue_alliance->'team_keys') ? $2::text)`,
      [input.eventKey, input.teamKey],
    ),
    client.query<{ name: string; expression: unknown }>(
      `SELECT name, expression FROM org_value_formulas WHERE org_id = $1::uuid ORDER BY name`,
      [input.orgId],
    ),
    client.query<TeamLogNoteRow>(
      `SELECT n.match_key AS "matchKey", n.note
         FROM match_notes_timeline_entries n
         JOIN matches_ref m ON m.match_key = n.match_key AND m.event_key = $2::text
        WHERE n.org_id = $1::uuid AND n.team_number = $3::int
        ORDER BY n.match_key, n.clock_seconds`,
      [input.orgId, input.eventKey, teamNumber],
    ),
    client.query<TeamLogVideoRow>(
      `SELECT DISTINCT ON (v.match_key) v.match_key AS "matchKey", v.video_url AS url
         FROM match_video_index_entries v
         JOIN matches_ref m ON m.match_key = v.match_key AND m.event_key = $2::text
        WHERE v.org_id = $1::uuid
        ORDER BY v.match_key, v.created_at DESC`,
      [input.orgId, input.eventKey],
    ),
  ]);

  const usable: OrgValueFormula[] = formulas.rows
    .filter((row) => row.expression && typeof row.expression === "object" && typeof row.name === "string" && row.name.trim())
    .map((row) => ({ name: row.name, expression: row.expression as FormulaExpression }));

  const log = buildTeamMatchLog({
    teamKey: input.teamKey,
    entries: entries.rows,
    matches: matches.rows,
    formulas: usable,
    notes: notes.rows,
    videos: videos.rows,
  });
  if (log.rows.length === 0) {
    return { status: "empty", message: "This robot has no matches on the synced schedule and no scouting yet." };
  }
  return { status: "ready", eventKey: input.eventKey, ...log };
}
