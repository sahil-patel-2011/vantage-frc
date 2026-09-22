// Server half of assignment-accountability.ts: the missed-assignment list for
// one event, for coordinator screens (/scout-coverage-live).
//
// Request path only — PoolClient from the caller's withRls, org-scoped SQL,
// one query per source, all in parallel. "Played" means TBA posted both scores,
// decided by the same allianceScore the schedule uses (TBA's -1 is not a score).

import type { PoolClient } from "@neondatabase/serverless";
import { allianceScore, type TbaAllianceJson } from "../schedule/tba-cache";
import { shortMatchLabel } from "../schedule/match-timeline";
import {
  detectMissedAssignments,
  type AccountabilityAssignment,
  type AccountabilityEntry,
  type MissedAssignment,
} from "./assignment-accountability";

export type MissedAssignmentRow = MissedAssignment & { matchLabel: string };

export async function loadMissedAssignments(
  client: PoolClient,
  input: { orgId: string; eventKey: string },
): Promise<MissedAssignmentRow[]> {
  const [matches, assignments, entries] = await Promise.all([
    client.query<{
      matchKey: string;
      compLevel: string;
      setNumber: number | null;
      matchNumber: number;
      redAlliance: TbaAllianceJson;
      blueAlliance: TbaAllianceJson;
    }>(
      `SELECT m.match_key AS "matchKey", m.comp_level AS "compLevel", m.set_number AS "setNumber",
              m.match_number AS "matchNumber", m.red_alliance AS "redAlliance", m.blue_alliance AS "blueAlliance"
         FROM matches_ref m
        WHERE m.event_key = $1::text
        ORDER BY CASE m.comp_level
                   WHEN 'qm' THEN 0 WHEN 'ef' THEN 1 WHEN 'qf' THEN 2
                   WHEN 'sf' THEN 3 WHEN 'f' THEN 4 ELSE 5
                 END, m.set_number, m.match_number`,
      [input.eventKey],
    ),
    client.query<AccountabilityAssignment>(
      `SELECT a.match_key AS "matchKey", a.team_key AS "teamKey", a.user_id AS "userId", a.role,
              COALESCE(NULLIF(btrim(p.display_name), ''), NULLIF(btrim(u.name), ''),
                  NULLIF(split_part(u.email, '@', 1), '')) AS name
         FROM scout_assignments a
         JOIN users u ON u.id = a.user_id
         LEFT JOIN profiles p ON p.user_id = a.user_id
        WHERE a.org_id = $1::uuid AND a.event_key = $2::text`,
      [input.orgId, input.eventKey],
    ),
    client.query<AccountabilityEntry>(
      `SELECT DISTINCT e.match_key AS "matchKey", e.team_key AS "teamKey", e.scout_user_id AS "scoutUserId"
         FROM match_scout_entries e
        WHERE e.org_id = $1::uuid AND e.event_key = $2::text`,
      [input.orgId, input.eventKey],
    ),
  ]);

  const labels = new Map<string, string>();
  const played: string[] = [];
  for (const match of matches.rows) {
    if (!match?.matchKey) continue;
    labels.set(match.matchKey, shortMatchLabel(match.compLevel, match.setNumber, Number(match.matchNumber)));
    if (allianceScore(match.redAlliance) != null && allianceScore(match.blueAlliance) != null) {
      played.push(match.matchKey);
    }
  }

  return detectMissedAssignments({
    assignments: assignments.rows,
    entries: entries.rows,
    playedMatchKeys: played,
  }).map((row) => ({ ...row, matchLabel: labels.get(row.matchKey) ?? row.matchKey }));
}
