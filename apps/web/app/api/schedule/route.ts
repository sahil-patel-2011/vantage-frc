import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { withSavepoint } from "@vantage/db/savepoint";
import { headers } from "next/headers";
import type { ScheduleContext } from "../../../lib/schedule-board";
import { fieldStdFromRatings } from "../../../lib/schedule/schedule-predictions";
import { buildScheduleView, type TbaMatchCacheRow } from "../../../lib/schedule/tba-cache";
import type {
  TimelineAssignmentRow,
  TimelineCountRow,
  TimelineEntryRow,
  TimelineVideoRow,
} from "../../../lib/schedule/match-timeline";
import { hydrateOrgActiveEvent } from "../../../lib/reference/hydrate-active-event";
import { publicErrorMessage } from "../../../lib/security/public-error";

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
  return Response.json({ error: publicErrorMessage(error, "Schedule request failed") }, { status });
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
          setupMessage: "Choose your team to view the match schedule, or join the waitlist.",
        });
      }

      if (!row.eventKey) {
        return buildScheduleView({
          context: { ...row, viewerUserId: session.user.id },
          setupMessage: "Set your active event on Your team.",
        });
      }

      // One round trip per source, all in parallel. Every org-scoped read is
      // filtered by org_id on top of RLS; per-match joining happens in
      // attachTimelineDetail, never as a query per match.
      const [matches, metrics, assignments, entries, notes, videos] = await Promise.all([
        client.query<TbaMatchCacheRow>(
          `SELECT m.match_key AS "matchKey", m.comp_level AS "compLevel", m.match_number AS "matchNumber",
                  m.set_number AS "setNumber",
                  COALESCE(m.actual_time, m.predicted_time, m.event_time)::text AS "scheduledTime",
                  m.event_time::text AS "plannedTime",
                  m.predicted_time::text AS "predictedTime",
                  m.actual_time::text AS "actualTime",
                  m.post_result_time::text AS "postResultTime",
                  m.red_alliance AS "redAlliance", m.blue_alliance AS "blueAlliance",
                  m.winning_alliance AS "winningAlliance",
                  m.videos->0->>'type' AS "tbaVideoType",
                  m.videos->0->>'key' AS "tbaVideoKey"
           FROM matches_ref m
           WHERE m.event_key = $1::text
           ORDER BY CASE m.comp_level
                      WHEN 'qm' THEN 0 WHEN 'ef' THEN 1 WHEN 'qf' THEN 2
                      WHEN 'sf' THEN 3 WHEN 'f' THEN 4 ELSE 5
                    END, m.set_number, m.match_number`,
          [row.eventKey],
        ),
        client.query<{ teamKey: string; epaTotal: number | null }>(
          `SELECT DISTINCT ON (m.team_key)
              m.team_key AS "teamKey",
              m.epa_total AS "epaTotal"
           FROM team_event_metrics m
           WHERE m.event_key = $1::text
           ORDER BY m.team_key,
             CASE m.source WHEN 'statbotics' THEN 0 WHEN 'tba' THEN 1 ELSE 2 END,
             m.synced_at DESC NULLS LAST`,
          [row.eventKey],
        ),
        client.query<TimelineAssignmentRow>(
          `SELECT a.match_key AS "matchKey", a.team_key AS "teamKey", a.user_id AS "userId", a.role,
                  COALESCE(NULLIF(btrim(p.display_name), ''), NULLIF(btrim(u.name), ''),
                           NULLIF(split_part(u.email, '@', 1), '')) AS name
           FROM scout_assignments a
           JOIN users u ON u.id = a.user_id
           LEFT JOIN profiles p ON p.user_id = a.user_id
           WHERE a.org_id = $1::uuid AND a.event_key = $2::text`,
          [row.orgId, row.eventKey],
        ),
        client.query<TimelineEntryRow>(
          `SELECT e.match_key AS "matchKey", e.team_key AS "teamKey", e.scout_user_id AS "scoutUserId",
                  count(*)::int AS count
           FROM match_scout_entries e
           WHERE e.org_id = $1::uuid AND e.event_key = $2::text
           GROUP BY e.match_key, e.team_key, e.scout_user_id`,
          [row.orgId, row.eventKey],
        ),
        client.query<TimelineCountRow>(
          `SELECT n.match_key AS "matchKey", count(*)::int AS count
           FROM match_notes_timeline_entries n
           JOIN matches_ref m ON m.match_key = n.match_key AND m.event_key = $2::text
           WHERE n.org_id = $1::uuid
           GROUP BY n.match_key`,
          [row.orgId, row.eventKey],
        ),
        client.query<TimelineVideoRow>(
          `SELECT DISTINCT ON (v.match_key) v.match_key AS "matchKey", v.video_url AS url
           FROM match_video_index_entries v
           JOIN matches_ref m ON m.match_key = v.match_key AND m.event_key = $2::text
           WHERE v.org_id = $1::uuid
           ORDER BY v.match_key, v.created_at DESC`,
          [row.orgId, row.eventKey],
        ),
      ]);

      // The team's own saved prediction wins where there is one: the Predict list said 71% for a
      // match Home and Strategy put at 75%. Missing table or no rows: the ratings estimate stays.
      const saved = await withSavepoint(
        client,
        async () =>
          (
            await client.query<{ matchKey: string; pRed: number }>(
              `SELECT DISTINCT ON (p.match_key) p.match_key AS "matchKey", p.p_red AS "pRed"
                 FROM predictions p
                 JOIN matches_ref m ON m.match_key = p.match_key AND m.event_key = $2::text
                WHERE p.org_id = $1::uuid AND p.p_red IS NOT NULL
                ORDER BY p.match_key, p.scored_at DESC`,
              [row.orgId, row.eventKey],
            )
          ).rows,
        [] as Array<{ matchKey: string; pRed: number }>,
      );
      const savedRedWin = new Map(saved.map((entry) => [entry.matchKey, Number(entry.pRed)]));

      const teamRatings = new Map<string, number>();
      for (const metric of metrics.rows) {
        if (metric.epaTotal == null || !Number.isFinite(metric.epaTotal)) continue;
        teamRatings.set(metric.teamKey, metric.epaTotal);
      }

      return buildScheduleView({
        context: { ...row, viewerUserId: session.user.id },
        rows: matches.rows,
        teamRatings,
        fieldStd: fieldStdFromRatings(teamRatings.values()),
        savedRedWin,
        detail: {
          assignments: assignments.rows,
          entries: entries.rows,
          notes: notes.rows,
          videos: videos.rows,
        },
      });
    });

    return Response.json(view);
  } catch (error) {
    return fail(error);
  }
}
