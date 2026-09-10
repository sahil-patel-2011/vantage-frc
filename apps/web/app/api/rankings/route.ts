import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import type { RankingsContext } from "../../../lib/rankings";
import { buildRankingsView, type TbaRankCacheRow } from "../../../lib/rankings/tba-cache";
import type { TbaMatchCacheRow } from "../../../lib/schedule/tba-cache";
import { hydrateOrgActiveEvent } from "../../../lib/reference/hydrate-active-event";

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

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const url = new URL(request.url);
    const requestedOrg = url.searchParams.get("orgId");
    await hydrateOrgActiveEvent({ userId: session.user.id, requestedOrg });

    const view = await withRls({ userId: session.user.id }, async (client) => {
      const membership = await client.query<RankingsContext>(
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
        return buildRankingsView({
          context: { orgId: null, orgName: null, teamNumber: null, role: null, eventKey: null, eventName: null },
          setupMessage: "Select a team to view event rankings.",
        });
      }

      if (!row.eventKey) {
        return buildRankingsView({
          context: row,
          setupMessage: "Select an active event on Your team.",
        });
      }

      const metrics = await client.query<TbaRankCacheRow>(
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

      const playoffRows = await client.query<TbaMatchCacheRow>(
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

      return buildRankingsView({
        context: row,
        metricRows: metrics.rows,
        playoffRows: playoffRows.rows,
      });
    });

    return Response.json(view);
  } catch (error) {
    return fail(error);
  }
}
