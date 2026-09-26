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

export type MyScoutEntry = {
  id: string;
  type: "match" | "pit";
  matchKey: string | null;
  teamKey: string;
  clientId: string | null;
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
  matchStatus: MatchStatus[];
  teamNumber: number | null;
};

export async function loadBootstrapExtras(
  client: Queryable,
  input: { orgId: string; userId: string; eventKey: string | null },
): Promise<BootstrapExtras> {
  const team = await client.query<{ teamNumber: number | null }>(
    `SELECT team_number AS "teamNumber" FROM organizations WHERE id = $1::uuid`,
    [input.orgId],
  );
  const teamNumber = team.rows[0]?.teamNumber ?? null;
  if (!input.eventKey) return { myEntries: [], scouted: [], matchStatus: [], teamNumber };

  const mine = await client.query<MyScoutEntry>(
    `SELECT e.id::text AS id, 'match' AS type, e.match_key AS "matchKey", e.team_key AS "teamKey",
            e.client_id AS "clientId", e.payload, e.confidence::text AS confidence, e.updated_at AS "updatedAt"
     FROM match_scout_entries e
     WHERE e.org_id = $1::uuid AND e.event_key = $2 AND e.scout_user_id = $3::uuid
     UNION ALL
     SELECT e.id::text, 'pit', NULL, e.team_key, e.client_id, e.payload, e.confidence::text, e.updated_at
     FROM pit_scout_entries e
     WHERE e.org_id = $1::uuid AND e.event_key = $2 AND e.scout_user_id = $3::uuid
     ORDER BY "updatedAt" DESC
     LIMIT 1000`,
    [input.orgId, input.eventKey, input.userId],
  );
  const scouted = await client.query<ScoutedRobot>(
    `SELECT DISTINCT match_key AS "matchKey", team_key AS "teamKey"
     FROM match_scout_entries
     WHERE org_id = $1::uuid AND event_key = $2 AND match_key IS NOT NULL`,
    [input.orgId, input.eventKey],
  );
  const status = await client.query<MatchStatus>(
    `SELECT match_key AS "matchKey", actual_time AS "actualTime", predicted_time AS "predictedTime",
            event_time AS "plannedTime", post_result_time AS "postResultTime",
            NULLIF(winning_alliance, '') AS "winningAlliance"
     FROM matches_ref WHERE event_key = $1`,
    [input.eventKey],
  );
  return { myEntries: mine.rows, scouted: scouted.rows, matchStatus: status.rows, teamNumber };
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
