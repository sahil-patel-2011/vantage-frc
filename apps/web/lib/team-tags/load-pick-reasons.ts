/**
 * Load drive-team tags through the request RLS client and project them as pick
 * reasons. Pick clock can call this without knowing the tag tables.
 */

import type { PoolClient } from "@neondatabase/serverless";
import { currentTeamTagsSeason } from "./compute-team-tags";
import type { TeamTagAssignment } from "./group";
import {
  pickReasonsForEvent,
  pickReasonsFromTeamTags,
  type TeamTagPickReason,
} from "./pick-reasons";

function isMissingRelation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    String((error as { code: unknown }).code) === "42P01"
  );
}

export async function loadTeamTagAssignments(
  client: PoolClient,
  input: {
    orgId: string;
    seasonYear?: number;
    eventKey?: string | null;
    teamNumber?: number | null;
  },
): Promise<TeamTagAssignment[]> {
  const seasonYear = input.seasonYear ?? currentTeamTagsSeason();
  try {
    const result = await client.query<TeamTagAssignment>(
      `SELECT t.id, t.tag_id AS "tagId", d.slug AS "tagSlug", d.name AS "tagName",
              t.team_number AS "teamNumber", t.event_key AS "eventKey", t.match_key AS "matchKey", t.notes
       FROM qualitative_team_tags t
       JOIN qualitative_tag_defs d ON d.id = t.tag_id AND d.org_id = t.org_id
       WHERE t.org_id = $1::uuid AND t.season_year = $2
         AND ($3::text IS NULL OR t.event_key = $3)
         AND ($4::int IS NULL OR t.team_number = $4)
       ORDER BY d.sort_order, t.team_number
       LIMIT 500`,
      [input.orgId, seasonYear, input.eventKey ?? null, input.teamNumber ?? null],
    );
    return result.rows;
  } catch (error) {
    if (isMissingRelation(error)) return [];
    throw error;
  }
}

/** Event robots only. Missing tables or an empty event key → []. */
export async function loadTeamTagPickReasons(
  client: PoolClient,
  input: {
    orgId: string;
    seasonYear?: number;
    eventKey: string;
    teamNumber?: number | null;
    limit?: number;
  },
): Promise<TeamTagPickReason[]> {
  if (!input.eventKey) return [];
  const assignments = await loadTeamTagAssignments(client, {
    orgId: input.orgId,
    seasonYear: input.seasonYear,
    eventKey: input.eventKey,
    teamNumber: input.teamNumber,
  });
  if (input.teamNumber != null) {
    return pickReasonsFromTeamTags(assignments, {
      teamNumber: input.teamNumber,
      eventKey: input.eventKey,
      limit: input.limit,
    });
  }
  const reasons = pickReasonsForEvent(assignments, input.eventKey);
  return input.limit != null ? reasons.slice(0, input.limit) : reasons;
}
