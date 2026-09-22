// Server half of assignment-conflicts.ts: build the context from the database.
//
// Request path only — the PoolClient comes from the caller's withRls, every
// statement is org-scoped on top of RLS, one query per source, all in parallel.

import type { PoolClient } from "@neondatabase/serverless";
import type { AssignmentConflictContext, ConflictMatch } from "./assignment-conflicts";

type AllianceJson = { teamKeys?: unknown; team_keys?: unknown } | null;

function allianceKeys(alliance: AllianceJson): string[] {
  const keys = alliance?.teamKeys ?? alliance?.team_keys;
  return Array.isArray(keys) ? keys.filter((key): key is string => typeof key === "string" && key.length > 0) : [];
}

export async function loadAssignmentConflictContext(
  client: PoolClient,
  input: { orgId: string; eventKey: string },
): Promise<AssignmentConflictContext> {
  const [team, standing, duties, matches, assignments] = await Promise.all([
    client.query<{ teamNumber: number | null }>(
      `SELECT team_number AS "teamNumber" FROM organizations WHERE id = $1::uuid`,
      [input.orgId],
    ),
    client.query<{ userId: string }>(
      `SELECT DISTINCT r.holder_user_id AS "userId"
         FROM team_roles r
        WHERE r.org_id = $1::uuid
          AND r.subteam = 'drive_team'
          AND r.holder_user_id IS NOT NULL
          AND r.season_year = (SELECT e.year FROM events_ref e WHERE e.event_key = $2::text)`,
      [input.orgId, input.eventKey],
    ),
    client.query<{ userId: string; startsAt: string; endsAt: string | null }>(
      `SELECT d.assigned_user_id AS "userId", d.starts_at::text AS "startsAt", d.ends_at::text AS "endsAt"
         FROM duty_assignments d
        WHERE d.org_id = $1::uuid
          AND d.kind = 'drive_team'
          AND d.assigned_user_id IS NOT NULL`,
      [input.orgId],
    ),
    client.query<{ matchKey: string; redAlliance: AllianceJson; blueAlliance: AllianceJson; time: string | null }>(
      `SELECT m.match_key AS "matchKey", m.red_alliance AS "redAlliance", m.blue_alliance AS "blueAlliance",
              COALESCE(m.predicted_time, m.event_time, m.actual_time)::text AS "time"
         FROM matches_ref m
        WHERE m.event_key = $1::text`,
      [input.eventKey],
    ),
    client.query<{ userId: string; matchKey: string; teamKey: string; role: string | null }>(
      `SELECT a.user_id AS "userId", a.match_key AS "matchKey", a.team_key AS "teamKey", a.role
         FROM scout_assignments a
        WHERE a.org_id = $1::uuid AND a.event_key = $2::text`,
      [input.orgId, input.eventKey],
    ),
  ]);

  const teamNumber = team.rows[0]?.teamNumber;
  const matchMap = new Map<string, ConflictMatch>();
  for (const row of matches.rows) {
    matchMap.set(row.matchKey, {
      matchKey: row.matchKey,
      teamKeys: [...allianceKeys(row.redAlliance), ...allianceKeys(row.blueAlliance)],
      time: row.time,
    });
  }
  return {
    ourTeamKey: teamNumber != null && Number(teamNumber) > 0 ? `frc${Number(teamNumber)}` : null,
    standingDriveTeam: new Set(standing.rows.map((row) => row.userId)),
    driveDuties: duties.rows,
    matches: matchMap,
    assignments: assignments.rows,
  };
}
