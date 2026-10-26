/**
 * What the scouting bootstrap adds on top of the repository's answer.
 *
 * The repository sends the team's 30 latest entries. Everything a scout's screens decide from
 * "what have I already scouted" used that list, so once the team had saved more than 30 the app
 * forgot older reports: Home sent a scout to a robot they had scouted twice, the tiles lost
 * their "Done" ticks, and Save made a duplicate. So the bootstrap also sends:
 *
 * - myEntries: every report the signed-in scout filed at this event, with its id and answers, so
 *   reopening one loads it and Save replaces it.
 * - scouted: every robot anyone on the team has a match report for at this event (keys only).
 * - match status per match (started, result posted, the live estimate), so the scout screens use
 *   the same "still to come" rule as Home and Event day, not a clock window.
 * - the team's own number, so our robot can be left out of pit visits.
 *
 * Plain parameterized SQL through the request's withRls client.
 */

type Queryable = {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
};
type RosterTeam = import("../intel/offline-teams").OfflineRosterTeam;

export type MyScoutEntry = {
  id: string;
  type: "match" | "pit";
  matchKey: string | null;
  teamKey: string;
  clientId: string | null;
  schemaId: string;
  payload: Record<string, unknown> | null;
  confidence: string;
  updatedAt: string;
};

export type ScoutedRobot = { matchKey: string; teamKey: string };

export type MatchStatus = {
  matchKey: string;
  actualTime: string | null;
  predictedTime: string | null;
  plannedTime: string | null;
  postResultTime: string | null;
  winningAlliance: string | null;
};

export type BootstrapExtras = {
  myEntries: MyScoutEntry[];
  scouted: ScoutedRobot[];
  pitScouted: string[];
  roster: RosterTeam[];
  rosterComplete: boolean;
  matchStatus: MatchStatus[];
  teamNumber: number | null;
};

export async function loadBootstrapExtras(
  client: Queryable,
  input: { orgId: string; userId: string; eventKey: string | null },
): Promise<BootstrapExtras> {
  const teamP = client.query<{ teamNumber: number | null }>(
    `SELECT team_number AS "teamNumber" FROM organizations WHERE id = $1::uuid`,
    [input.orgId],
  );
  if (!input.eventKey) {
    const team = await teamP;
    return { myEntries: [], scouted: [], pitScouted: [], roster: [], rosterComplete: false, matchStatus: [], teamNumber: team.rows[0]?.teamNumber ?? null };
  }

  const mineP = client.query<MyScoutEntry>(
    `SELECT e.id::text AS id, 'match' AS type, e.match_key AS "matchKey", e.team_key AS "teamKey",
            e.client_id AS "clientId", e.schema_id AS "schemaId", e.payload, e.confidence::text AS confidence, e.updated_at AS "updatedAt"
     FROM match_scout_entries e
     WHERE e.org_id = $1::uuid AND e.event_key = $2 AND e.scout_user_id = $3::uuid
     UNION ALL
     SELECT e.id::text, 'pit', NULL, e.team_key, e.client_id, e.schema_id, e.payload, e.confidence::text, e.updated_at
     FROM pit_scout_entries e
     WHERE e.org_id = $1::uuid AND e.event_key = $2 AND e.scout_user_id = $3::uuid
     ORDER BY "updatedAt" DESC
     LIMIT 1000`,
    [input.orgId, input.eventKey, input.userId],
  );
  const scoutedP = client.query<{ type: string; matchKey: string | null; teamKey: string; nickname: string | null }>(
    `WITH coverage AS (SELECT DISTINCT 'match' AS type, match_key AS "matchKey", team_key AS "teamKey"
     FROM match_scout_entries
     WHERE org_id = $1::uuid AND event_key = $2 AND match_key IS NOT NULL
     UNION SELECT DISTINCT 'pit', NULL::text, team_key FROM pit_scout_entries
     WHERE org_id = $1::uuid AND event_key = $2
     UNION SELECT 'roster', NULL::text, team_key FROM (
       SELECT team_key FROM team_event_metrics WHERE event_key=$2
       UNION SELECT jsonb_array_elements_text(red_alliance->'teamKeys') FROM matches_ref WHERE event_key=$2
       UNION SELECT jsonb_array_elements_text(blue_alliance->'teamKeys') FROM matches_ref WHERE event_key=$2
     ) event_teams)
     SELECT coverage.*, t.nickname FROM coverage LEFT JOIN teams_ref t ON t.team_key=coverage."teamKey"`,
    [input.orgId, input.eventKey],
  );
  const statusP = client.query<MatchStatus>(
    `SELECT match_key AS "matchKey", actual_time AS "actualTime", predicted_time AS "predictedTime",
            event_time AS "plannedTime", post_result_time AS "postResultTime",
            NULLIF(winning_alliance, '') AS "winningAlliance"
     FROM matches_ref WHERE event_key = $1`,
    [input.eventKey],
  );
  const [team, mine, scouted, status] = await Promise.all([teamP, mineP, scoutedP, statusP]);
  const teamNumber = team.rows[0]?.teamNumber ?? null;
  const roster = new Map<string, RosterTeam>();
  for (const row of scouted.rows) {
    const teamNumber = Number(row.teamKey.replace(/^frc/, ""));
    if (!Number.isInteger(teamNumber) || teamNumber <= 0) continue;
    const team = roster.get(row.teamKey) ?? { teamKey: row.teamKey, teamNumber, nickname: row.nickname, epaTotal: null, scouted: 0, pitScouted: 0 };
    if (row.type === "match") team.scouted++;
    if (row.type === "pit") team.pitScouted = 1;
    roster.set(row.teamKey, team);
  }
  return { myEntries: mine.rows, roster: [...roster.values()], rosterComplete: scouted.rows.some(row => row.type === "roster"),
    scouted: scouted.rows.flatMap(row => row.type === "match" && row.matchKey ? [{ matchKey: row.matchKey, teamKey: row.teamKey }] : []),
    pitScouted: scouted.rows.filter(row => row.type === "pit").map(row => row.teamKey),
    matchStatus: status.rows, teamNumber };
}

/** Put each match's status fields on the bootstrap's match rows. */
export function withMatchStatus<T extends { matchKey: string }>(
  matches: readonly T[],
  status: readonly MatchStatus[],
): Array<T & Omit<MatchStatus, "matchKey">> {
  const byKey = new Map(status.map((row) => [row.matchKey, row]));
  return matches.map((match) => {
    const row = byKey.get(match.matchKey);
    return {
      ...match,
      actualTime: row?.actualTime ?? null,
      predictedTime: row?.predictedTime ?? null,
      plannedTime: row?.plannedTime ?? null,
      postResultTime: row?.postResultTime ?? null,
      winningAlliance: row?.winningAlliance ?? null,
    };
  });
}
