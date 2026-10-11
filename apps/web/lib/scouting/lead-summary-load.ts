// Server half of lead-summary.ts. Request path only: the PoolClient comes from the caller's
// withRls, every query is org-scoped and parameterized, and they run in parallel. "Played"
// is scouting's one rule (play-state.ts), the same the Assignments board and Quick scout use.

import type { PoolClient } from "@neondatabase/serverless";
import { canManageScouting } from "@vantage/scouting/permissions";
import { allianceScore, allianceTeamKeys, type TbaAllianceJson } from "../schedule/tba-cache";
import type { AccountabilityAssignment } from "./assignment-accountability";
import { summarizeScouting, type LeadSummary, type SummaryEntry, type SummaryMember, type SummaryRosterTeam } from "./lead-summary";
import { playedMatchKeys } from "./play-state";

export type LeadSummaryView =
  | { status: "no_event"; canLead: boolean }
  | ({
      status: "ready";
      eventKey: string;
      eventName: string | null;
      canLead: boolean;
      /** Open disagreements between scouts at this event (leads only; null for everyone else). */
      openDisagreements: number | null;
    } & LeadSummary);

const NAME = `COALESCE(NULLIF(btrim(p.display_name), ''), NULLIF(btrim(u.name), ''), NULLIF(split_part(u.email, '@', 1), ''), 'Team member')`;

export async function loadLeadSummary(
  client: PoolClient,
  input: { orgId: string; userId: string },
): Promise<LeadSummaryView> {
  const [canLead, context] = await Promise.all([
    canManageScouting(client, input.orgId),
    client.query<{ eventKey: string | null; eventName: string | null; teamNumber: number | null }>(
      `SELECT c.active_event_key AS "eventKey", e.name AS "eventName", o.team_number AS "teamNumber"
         FROM organizations o
         LEFT JOIN org_active_context c ON c.org_id = o.id
         LEFT JOIN events_ref e ON e.event_key = c.active_event_key
        WHERE o.id = $1::uuid`,
      [input.orgId],
    ),
  ]);
  const eventKey = context.rows[0]?.eventKey ?? null;
  if (!eventKey) return { status: "no_event", canLead };
  const params = [input.orgId, eventKey];

  const [roster, matches, matchEntries, pitEntries, assignments, members, disagreements] = await Promise.all([
    // The event's teams come from the event (its schedule and its team list). A pit report
    // for a typed team number no longer adds that team to the event: summarizeScouting lists
    // it apart, under otherVisited.
    client.query<SummaryRosterTeam>(
      `WITH roster AS (
         SELECT jsonb_array_elements_text(m.red_alliance->'teamKeys') AS team_key FROM matches_ref m WHERE m.event_key = $1::text
         UNION SELECT jsonb_array_elements_text(m.blue_alliance->'teamKeys') FROM matches_ref m WHERE m.event_key = $1::text
         UNION SELECT tm.team_key FROM team_event_metrics tm WHERE tm.event_key = $1::text
       )
       SELECT r.team_key AS "teamKey",
              COALESCE(t.team_number, NULLIF(regexp_replace(r.team_key, '\\D', '', 'g'), '')::int) AS "teamNumber",
              t.nickname
         FROM roster r LEFT JOIN teams_ref t ON t.team_key = r.team_key
        WHERE r.team_key ~ '^frc[0-9]+$'`,
      [eventKey],
    ),
    client.query<{
      matchKey: string;
      compLevel: string | null;
      matchNumber: number;
      redAlliance: TbaAllianceJson;
      blueAlliance: TbaAllianceJson;
      winningAlliance: string | null;
      postResultTime: string | null;
      actualTime: string | null;
    }>(
      `SELECT m.match_key AS "matchKey", m.comp_level AS "compLevel", m.match_number AS "matchNumber",
              m.red_alliance AS "redAlliance", m.blue_alliance AS "blueAlliance",
              NULLIF(m.winning_alliance, '') AS "winningAlliance",
              m.post_result_time::text AS "postResultTime", m.actual_time::text AS "actualTime"
         FROM matches_ref m WHERE m.event_key = $1::text`,
      [eventKey],
    ),
    client.query<SummaryEntry>(
      `SELECT 'match' AS type, e.match_key AS "matchKey", e.team_key AS "teamKey", e.scout_user_id::text AS "scoutUserId",
              to_char(e.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "updatedAt"
         FROM match_scout_entries e WHERE e.org_id = $1::uuid AND e.event_key = $2::text`,
      params,
    ),
    client.query<SummaryEntry>(
      `SELECT 'pit' AS type, NULL::text AS "matchKey", e.team_key AS "teamKey", e.scout_user_id::text AS "scoutUserId",
              to_char(e.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "updatedAt"
         FROM pit_scout_entries e WHERE e.org_id = $1::uuid AND e.event_key = $2::text`,
      params,
    ),
    client.query<AccountabilityAssignment>(
      `SELECT a.match_key AS "matchKey", a.team_key AS "teamKey", a.user_id::text AS "userId", a.role, ${NAME} AS name
         FROM scout_assignments a
         JOIN users u ON u.id = a.user_id
         LEFT JOIN profiles p ON p.user_id = a.user_id
        WHERE a.org_id = $1::uuid AND a.event_key = $2::text`,
      params,
    ),
    client.query<SummaryMember>(
      `SELECT m.user_id::text AS "userId", ${NAME} AS name, m.role::text AS role
         FROM memberships m
         JOIN users u ON u.id = m.user_id
         LEFT JOIN profiles p ON p.user_id = m.user_id
        WHERE m.org_id = $1::uuid`,
      [input.orgId],
    ),
    canLead
      ? client.query<{ open: number }>(
          `SELECT count(*)::int AS open FROM scout_disagreements
            WHERE org_id = $1::uuid AND event_key = $2::text AND status = 'open'`,
          params,
        )
      : Promise.resolve(null),
  ]);

  const played = playedMatchKeys(
    matches.rows.map((match) => ({
      ...match,
      matchNumber: Number(match.matchNumber),
      redScore: allianceScore(match.redAlliance),
      blueScore: allianceScore(match.blueAlliance),
    })),
  );
  const summary = summarizeScouting({
    roster: roster.rows,
    ownTeamNumber: context.rows[0]?.teamNumber ?? null,
    matches: matches.rows.map((match) => ({
      matchKey: match.matchKey,
      teamKeys: [...allianceTeamKeys(match.redAlliance), ...allianceTeamKeys(match.blueAlliance)],
      played: played.has(match.matchKey),
    })),
    entries: [...matchEntries.rows, ...pitEntries.rows],
    assignments: assignments.rows,
    members: members.rows,
    userId: input.userId,
  });

  return {
    status: "ready",
    eventKey,
    eventName: context.rows[0]?.eventName ?? null,
    canLead,
    openDisagreements: disagreements ? (disagreements.rows[0]?.open ?? 0) : null,
    ...summary,
    // Other scouts' numbers are for the people who run scouting; everyone sees their own.
    scouts: canLead ? summary.scouts : summary.scouts.filter((row) => row.userId === input.userId),
  };
}
