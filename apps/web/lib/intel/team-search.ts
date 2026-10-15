import type { PoolClient } from "@neondatabase/serverless";

/**
 * Research team lookup against the shared `teams_ref` cache — every team Vantage knows, not
 * only the active event's.
 *
 * The old query (packages/intel-research searchTeams) compared `team_number::text = $2`, which
 * cannot use `teams_ref_number_idx`, and ran a JSONB `?` probe of the active event's matches for
 * every candidate row before it could sort and LIMIT. This one:
 *   - matches a number with `team_number = $n::int` (indexed) first,
 *   - then nickname/name ILIKE, capped by a LIMIT inside the branch,
 *   - works out "at your event" once from the active event's schedule and ratings.
 * It never calls TBA: a team that is not in the cache comes back as an empty list and the page
 * says so plainly (teamSearchEmptyCopy).
 */
export type TeamSearchRow = {
  teamKey: string;
  teamNumber: number;
  nickname: string | null;
  name: string | null;
  city: string | null;
  stateProv: string | null;
  country: string | null;
  rookieYear: number | null;
  atActiveEvent: boolean;
};

export type ParsedTeamQuery =
  | { kind: "empty" }
  | { kind: "number"; teamNumber: number; text: string }
  | { kind: "text"; text: string };

const MAX_TEAM_NUMBER = 99_999;

/** "254", "frc254", "Team 254" and "#254" are a team number; anything else is a name search. */
export function parseTeamQuery(raw: string | null | undefined): ParsedTeamQuery {
  const text = (raw ?? "").trim().slice(0, 80);
  if (!text) return { kind: "empty" };
  const numeric = /^(?:frc|team)?\s*#?\s*(\d{1,5})$/i.exec(text);
  if (numeric) {
    const teamNumber = Number(numeric[1]);
    if (Number.isInteger(teamNumber) && teamNumber > 0 && teamNumber <= MAX_TEAM_NUMBER) {
      return { kind: "number", teamNumber, text: numeric[1]! };
    }
  }
  return { kind: "text", text };
}

/** ILIKE pattern with the user's own % and _ taken literally. */
export function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

export async function searchTeamsRef(
  client: PoolClient,
  orgId: string,
  rawQuery: string,
  limit = 20,
): Promise<TeamSearchRow[]> {
  const parsed = parseTeamQuery(rawQuery);
  if (parsed.kind === "empty") return [];
  const bounded = Math.min(Math.max(Math.trunc(limit), 1), 50);
  const teamNumber = parsed.kind === "number" ? parsed.teamNumber : null;
  const result = await client.query<TeamSearchRow>(
    `WITH active AS (
       SELECT c.active_event_key AS event_key
         FROM org_active_context c
        WHERE c.org_id = $1::uuid AND c.active_event_key IS NOT NULL
     ),
     at_event AS (
       SELECT jsonb_array_elements_text(m.red_alliance->'teamKeys') AS team_key
         FROM matches_ref m JOIN active a ON a.event_key = m.event_key
       UNION
       SELECT jsonb_array_elements_text(m.blue_alliance->'teamKeys')
         FROM matches_ref m JOIN active a ON a.event_key = m.event_key
       UNION
       SELECT tm.team_key
         FROM team_event_metrics tm JOIN active a ON a.event_key = tm.event_key
     ),
     exact AS (
       SELECT t.team_key, 0 AS tier
         FROM teams_ref t
        WHERE $2::int IS NOT NULL AND t.team_number = $2::int
     ),
     named AS (
       SELECT t.team_key, 1 AS tier
         FROM teams_ref t
        WHERE (t.nickname ILIKE $3::text OR t.name ILIKE $3::text)
          AND ($2::int IS NULL OR t.team_number <> $2::int)
        ORDER BY (t.team_key IN (SELECT team_key FROM at_event)) DESC, t.team_number
        LIMIT $4::int
     ),
     hits AS (
       SELECT team_key, tier FROM exact
       UNION ALL
       SELECT team_key, tier FROM named
     )
     SELECT t.team_key AS "teamKey", t.team_number AS "teamNumber", t.nickname, t.name,
            t.city, t.state_prov AS "stateProv", t.country, t.rookie_year AS "rookieYear",
            (t.team_key IN (SELECT team_key FROM at_event)) AS "atActiveEvent"
       FROM hits h JOIN teams_ref t ON t.team_key = h.team_key
      ORDER BY h.tier, "atActiveEvent" DESC, t.team_number
      LIMIT $4::int`,
    [orgId, teamNumber, likePattern(parsed.text), bounded],
  );
  return result.rows;
}

/**
 * What the page says when a lookup finds nothing. Plain about why (the team is not in Vantage's
 * shared team list, which fills as events are synced) and what happens next.
 */
export function teamSearchEmptyCopy(rawQuery: string, options: { offline?: boolean } = {}): string {
  const parsed = parseTeamQuery(rawQuery);
  if (options.offline) {
    return parsed.kind === "number"
      ? `Offline — Team ${parsed.teamNumber} isn't in this event's team list saved on this device. Search again when you're back online.`
      : `Offline — no team at this event matches "${parsed.kind === "text" ? parsed.text : ""}". Search again when you're back online.`;
  }
  if (parsed.kind === "number") {
    return `Team ${parsed.teamNumber} isn't in Vantage's team list yet. Teams are added when an event they're entered in is synced, so it will show up here once one of its events is loaded.`;
  }
  if (parsed.kind === "text") {
    return `No team matches "${parsed.text}". Try the team number instead.`;
  }
  return "Type a team number or name.";
}

export type LookupFailure = "superseded" | "timeout" | "offline" | "network";

/**
 * Why a lookup fetch threw. A newer search cancelling this one is not an error; a slow answer is
 * "taking longer than usual", not "offline" — only no signal (or a refused connection) is offline.
 */
export function classifyLookupFailure(
  error: unknown,
  options: { superseded: boolean; online: boolean },
): LookupFailure {
  if (options.superseded) return "superseded";
  const name = error && typeof error === "object" && "name" in error ? String((error as { name: unknown }).name) : "";
  if (name === "TimeoutError") return "timeout";
  if (!options.online) return "offline";
  if (name === "AbortError") return "timeout";
  return "network";
}
