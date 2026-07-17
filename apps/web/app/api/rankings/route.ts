import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  formatRecord,
  parsePlayoffLabel,
  sortRanked,
  teamNumberFromKey,
  type PlayoffMatch,
  type RankedTeam,
  type RankingsView,
} from "../../../lib/rankings";

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new HttpError(401, "Authentication required");
  return session;
}

function fail(error: unknown) {
  const status = error instanceof HttpError ? error.status : 400;
  return Response.json({ error: error instanceof Error ? error.message : "Rankings request failed" }, { status });
}

type AllianceJson = { teamKeys?: unknown; score?: unknown } | null;

function teamKeys(alliance: AllianceJson): string[] {
  const keys = alliance?.teamKeys;
  if (!Array.isArray(keys)) return [];
  return keys.map((key) => String(key));
}

function allianceScore(alliance: AllianceJson): number | null {
  const score = alliance?.score;
  return score == null ? null : Number(score);
}

/** Later of two synced_at texts (Date compare, lexicographic fallback). */
function laterSync(current: string | null, candidate: string | null): string | null {
  if (!candidate) return current;
  if (!current) return candidate;
  const a = Date.parse(current);
  const b = Date.parse(candidate);
  if (!Number.isNaN(a) && !Number.isNaN(b)) return b > a ? candidate : current;
  return candidate > current ? candidate : current;
}

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const url = new URL(request.url);
    const requestedOrg = url.searchParams.get("orgId");

    const view = await withRls({ userId: session.user.id }, async (client) => {
      const membership = await client.query<{
        orgId: string;
        orgName: string;
        teamNumber: number | null;
        role: string;
        eventKey: string | null;
        eventName: string | null;
      }>(
        `SELECT m.org_id AS "orgId", o.name AS "orgName", o.team_number AS "teamNumber", m.role,
                c.active_event_key AS "eventKey", e.name AS "eventName"
         FROM memberships m
         JOIN organizations o ON o.id = m.org_id
         LEFT JOIN org_active_context c ON c.org_id = o.id
         LEFT JOIN events_ref e ON e.event_key = c.active_event_key
         WHERE m.user_id = $1 AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
         ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
         LIMIT 1`,
        [session.user.id, requestedOrg],
      );

      const row = membership.rows[0];
      if (!row) {
        return {
          status: "setup_required",
          message: "Select a team workspace to view event rankings.",
          context: { orgId: null, orgName: null, teamNumber: null, role: null, eventKey: null, eventName: null },
        } satisfies RankingsView;
      }

      const context = {
        orgId: row.orgId,
        orgName: row.orgName,
        teamNumber: row.teamNumber,
        role: row.role,
        eventKey: row.eventKey,
        eventName: row.eventName,
      };

      if (!row.eventKey) {
        return {
          status: "setup_required",
          message: "Select an active event in Workspace.",
          context,
        } satisfies RankingsView;
      }

      const metrics = await client.query<{
        teamKey: string;
        nickname: string | null;
        rank: number | null;
        wins: number | null;
        losses: number | null;
        ties: number | null;
        epaTotal: number | null;
        epaAuto: number | null;
        epaTeleop: number | null;
        epaEndgame: number | null;
        source: string | null;
        syncedAt: string | null;
      }>(
        `SELECT DISTINCT ON (t.team_key)
                t.team_key AS "teamKey", r.nickname,
                t.rank, t.wins, t.losses, t.ties,
                t.epa_total AS "epaTotal", t.epa_auto AS "epaAuto",
                t.epa_teleop AS "epaTeleop", t.epa_endgame AS "epaEndgame",
                t.source, t.synced_at::text AS "syncedAt"
         FROM team_event_metrics t
         LEFT JOIN teams_ref r ON r.team_key = t.team_key
         WHERE t.event_key = $1
         ORDER BY t.team_key,
                  CASE t.source WHEN 'statbotics' THEN 0 WHEN 'tba' THEN 1 ELSE 2 END,
                  t.synced_at DESC NULLS LAST`,
        [row.eventKey],
      );

      const playoffRows = await client.query<{
        matchKey: string;
        compLevel: string;
        matchNumber: number;
        scheduledTime: string | null;
        redAlliance: AllianceJson;
        blueAlliance: AllianceJson;
        winningAlliance: string | null;
        syncedAt: string | null;
      }>(
        `SELECT m.match_key AS "matchKey", m.comp_level AS "compLevel", m.match_number AS "matchNumber",
                COALESCE(m.actual_time, m.predicted_time, m.event_time)::text AS "scheduledTime",
                m.red_alliance AS "redAlliance", m.blue_alliance AS "blueAlliance",
                m.winning_alliance AS "winningAlliance", m.synced_at::text AS "syncedAt"
         FROM matches_ref m
         WHERE m.event_key = $1 AND m.comp_level IN ('ef', 'qf', 'sf', 'f')
         ORDER BY CASE m.comp_level
                    WHEN 'ef' THEN 0 WHEN 'qf' THEN 1 WHEN 'sf' THEN 2 WHEN 'f' THEN 3 ELSE 4
                  END, m.set_number, m.match_number`,
        [row.eventKey],
      );

      let syncedAt: string | null = null;
      for (const entry of metrics.rows) syncedAt = laterSync(syncedAt, entry.syncedAt);
      for (const entry of playoffRows.rows) syncedAt = laterSync(syncedAt, entry.syncedAt);

      const teams: RankedTeam[] = metrics.rows.map((entry) => ({
        teamKey: entry.teamKey,
        teamNumber: teamNumberFromKey(entry.teamKey),
        nickname: entry.nickname,
        rank: entry.rank == null ? null : Number(entry.rank),
        record: formatRecord(
          entry.wins == null ? null : Number(entry.wins),
          entry.losses == null ? null : Number(entry.losses),
          entry.ties == null ? null : Number(entry.ties),
        ),
        epaTotal: entry.epaTotal == null ? null : Number(entry.epaTotal),
        epaAuto: entry.epaAuto == null ? null : Number(entry.epaAuto),
        epaTeleop: entry.epaTeleop == null ? null : Number(entry.epaTeleop),
        epaEndgame: entry.epaEndgame == null ? null : Number(entry.epaEndgame),
        source: entry.source,
      }));

      const playoffs: PlayoffMatch[] = playoffRows.rows.map((entry) => ({
        matchKey: entry.matchKey,
        compLevel: entry.compLevel,
        matchNumber: entry.matchNumber,
        label: parsePlayoffLabel(entry.matchKey, entry.compLevel, entry.matchNumber),
        red: teamKeys(entry.redAlliance),
        blue: teamKeys(entry.blueAlliance),
        redScore: allianceScore(entry.redAlliance),
        blueScore: allianceScore(entry.blueAlliance),
        winner: entry.winningAlliance === "red" || entry.winningAlliance === "blue" ? entry.winningAlliance : null,
        scheduledTime: entry.scheduledTime,
      }));

      return { status: "ready", context, teams: sortRanked(teams), playoffs, syncedAt } satisfies RankingsView;
    });

    return Response.json(view);
  } catch (error) {
    return fail(error);
  }
}
