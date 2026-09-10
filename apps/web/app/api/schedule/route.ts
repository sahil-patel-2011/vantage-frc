import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import type { ScheduleContext } from "../../../lib/schedule-board";
import { buildScheduleView, type TbaMatchCacheRow } from "../../../lib/schedule/tba-cache";
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
  return Response.json({ error: error instanceof Error ? error.message : "Schedule request failed" }, { status });
}

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const url = new URL(request.url);
    const requestedOrg = url.searchParams.get("orgId");
    await hydrateOrgActiveEvent({ userId: session.user.id, requestedOrg });

    const view = await withRls({ userId: session.user.id }, async (client) => {
      const membership = await client.query<ScheduleContext>(
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
        return buildScheduleView({
          context: { orgId: null, orgName: null, teamNumber: null, role: null, eventKey: null, eventName: null },
          setupMessage: "Choose your team to view the match schedule.",
        });
      }

      if (!row.eventKey) {
        return buildScheduleView({
          context: row,
          setupMessage: "Set your active event on Your team.",
        });
      }

      const matches = await client.query<TbaMatchCacheRow>(
        `SELECT m.match_key AS "matchKey", m.comp_level AS "compLevel", m.match_number AS "matchNumber",
                COALESCE(m.actual_time, m.predicted_time, m.event_time)::text AS "scheduledTime",
                m.red_alliance AS "redAlliance", m.blue_alliance AS "blueAlliance",
                m.winning_alliance AS "winningAlliance",
                (SELECT count(*)::int FROM scout_assignments a
                 WHERE a.org_id = $2 AND a.match_key = m.match_key) AS "scoutCount"
         FROM matches_ref m
         WHERE m.event_key = $1
         ORDER BY CASE m.comp_level
                    WHEN 'qm' THEN 0 WHEN 'ef' THEN 1 WHEN 'qf' THEN 2
                    WHEN 'sf' THEN 3 WHEN 'f' THEN 4 ELSE 5
                  END, m.match_number`,
        [row.eventKey, row.orgId],
      );

      return buildScheduleView({ context: row, rows: matches.rows });
    });

    return Response.json(view);
  } catch (error) {
    return fail(error);
  }
}
