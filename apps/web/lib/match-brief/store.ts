import type { PoolClient } from "@neondatabase/serverless";
import { MATCH_BRIEF_KIND, type MatchBrief } from "./types";

/** The team's newest brief for a match (everyone on the team reads the same one). */
export async function loadLatestMatchBrief(client: PoolClient, orgId: string, matchKey: string): Promise<MatchBrief | null> {
  const result = await client.query<{ brief: MatchBrief }>(
    `SELECT callouts AS brief
       FROM match_copilot_briefs
      WHERE org_id = $1::uuid AND match_key = $2::text
        AND jsonb_typeof(callouts) = 'object' AND callouts->>'kind' = $3::text
      ORDER BY created_at DESC
      LIMIT 1`,
    [orgId, matchKey, MATCH_BRIEF_KIND],
  );
  return result.rows[0]?.brief ?? null;
}

export async function saveMatchBrief(client: PoolClient, input: { orgId: string; userId: string; brief: MatchBrief }) {
  await client.query(
    `INSERT INTO match_copilot_briefs (org_id, match_key, alliance, callouts, generated_by, created_by)
     VALUES ($1::uuid, $2::text, $3::text, $4::jsonb, $5::text, $6::uuid)`,
    [input.orgId, input.brief.matchKey, input.brief.alliance, JSON.stringify(input.brief), input.brief.source.writer, input.userId],
  );
}

/** What a brief was written from: the event's latest played match and how much scouting existed. */
export async function loadBriefInputs(client: PoolClient, orgId: string, eventKey: string) {
  const [played, scouted] = await Promise.all([
    client.query<{ matchKey: string }>(
      `SELECT match_key AS "matchKey"
         FROM matches_ref
        WHERE event_key = $1::text AND winning_alliance IS NOT NULL
        ORDER BY COALESCE(actual_time, post_result_time, predicted_time) DESC NULLS LAST, match_number DESC
        LIMIT 1`,
      [eventKey],
    ),
    client.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM match_scout_entries WHERE org_id = $1::uuid AND event_key = $2::text`,
      [orgId, eventKey],
    ),
  ]);
  return { lastPlayedMatch: played.rows[0]?.matchKey ?? null, scoutReports: Number(scouted.rows[0]?.count ?? 0) };
}

/** Scout reports added since a brief that make it worth rewriting (about one more match's worth). */
export const STALE_AFTER_NEW_REPORTS = 6;

/**
 * A brief is out of date once a newer match has been played at the event, or a match's worth of
 * new scouting has come in. Rewriting then picks up what was learned in between (written at
 * match 50 and read at 65, it is rewritten with matches 51–64).
 */
export function briefIsStale(brief: MatchBrief | null, now: { lastPlayedMatch: string | null; scoutReports: number }): boolean {
  if (!brief) return true;
  if (now.lastPlayedMatch && now.lastPlayedMatch !== brief.source.lastPlayedMatch) return true;
  return now.scoutReports - brief.source.scoutReports >= STALE_AFTER_NEW_REPORTS;
}
