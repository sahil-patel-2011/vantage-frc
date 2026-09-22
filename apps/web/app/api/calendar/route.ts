import type { PoolClient } from "@neondatabase/serverless";
import { auth } from "@vantage/core";
import { withRls, withSavepoint } from "@vantage/db";
import { headers } from "next/headers";
import type { OverlayMeeting } from "../../../lib/calendar/meetings-overlay";
import {
  expandSeriesRows,
  type SeriesRow,
  type StoredException,
} from "../../../lib/calendar/series";
import {
  listSeasonTemplates,
  parseCalendarAction,
  seedFromKickoff,
  type CalendarView,
  type LinkedDeadline,
  type Milestone,
} from "../../../lib/season-calendar";

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

async function requireMembership(client: PoolClient, orgId: string, userId: string) {
  const row = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2 LIMIT 1`, [orgId, userId]);
  if (!row.rowCount) throw new HttpError(403, "Organization membership required");
}

function fail(error: unknown) {
  const status = error instanceof HttpError ? error.status : 400;
  return Response.json({ error: error instanceof Error ? error.message : "Calendar request failed" }, { status });
}

/** Upcoming grant / purchase dates from business — read-only markers, never invented. */
async function loadLinkedDeadlines(client: PoolClient, orgId: string): Promise<LinkedDeadline[]> {
  const grants = await client.query<{ id: string; title: string; dueOn: string }>(
    `SELECT id, name AS title, deadline::text AS "dueOn"
     FROM grant_opportunities
     WHERE org_id = $1 AND deadline IS NOT NULL AND deadline >= CURRENT_DATE
     ORDER BY deadline ASC
     LIMIT 12`,
    [orgId],
  );
  const purchases = await client.query<{ id: string; title: string; dueOn: string }>(
    `SELECT id, title, needed_by::text AS "dueOn"
     FROM purchase_requests
     WHERE org_id = $1
       AND needed_by IS NOT NULL
       AND needed_by >= CURRENT_DATE
       AND status IS DISTINCT FROM 'rejected'
     ORDER BY needed_by ASC
     LIMIT 12`,
    [orgId],
  );

  const linked: LinkedDeadline[] = [
    ...grants.rows.map((row) => ({
      id: row.id,
      source: "grant" as const,
      title: row.title,
      dueOn: row.dueOn,
      href: `/business?orgId=${encodeURIComponent(orgId)}`,
    })),
    ...purchases.rows.map((row) => ({
      id: row.id,
      source: "purchase" as const,
      title: row.title,
      dueOn: row.dueOn,
      href: `/business?orgId=${encodeURIComponent(orgId)}`,
    })),
  ];
  linked.sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.title.localeCompare(b.title));
  return linked.slice(0, 16);
}

/**
 * The team's real meetings, for the month grid to draw underneath the season.
 *
 * Read-only, and owned by `/team/calendar`. See the note at the top of
 * `lib/calendar/meetings-overlay.ts` for why these two calendars stay separate
 * and why the grid still has to show both.
 *
 * Recurring meetings are expanded here rather than shipped as rules: a build
 * season is mostly one weekly rule, and a client that received the rule would
 * have to reimplement the exception handling that `series.ts` already does.
 */
const OVERLAY_LOOKBACK_DAYS = 200;
const OVERLAY_LOOKAHEAD_DAYS = 400;
/** A season of three meetings a week is ~180; the ceiling is a runaway guard. */
const MAX_OVERLAY_MEETINGS = 800;

type OverlayEventRow = OverlayMeeting & SeriesRow;

async function loadMeetingOverlay(client: PoolClient, orgId: string): Promise<OverlayMeeting[]> {
  const now = Date.now();
  const window = {
    windowStart: new Date(now - OVERLAY_LOOKBACK_DAYS * 86_400_000).toISOString(),
    windowEnd: new Date(now + OVERLAY_LOOKAHEAD_DAYS * 86_400_000).toISOString(),
    maxPerSeries: 200,
  };

  const columns = `e.id, e.title, e.starts_at::text AS "startsAt", e.ends_at::text AS "endsAt",
                   st.name AS "subteamName", st.color AS "subteamColor"`;
  const joins = `FROM subteam_calendar_events e
                 LEFT JOIN team_subteams st ON st.id = e.subteam_id`;

  let rows: OverlayEventRow[];
  try {
    const result = await client.query<OverlayEventRow>(
      `SELECT ${columns},
              e.rrule, e.recurrence_end::text AS "recurrenceEnd",
              e.series_id AS "seriesId", e.recurrence_timezone AS "recurrenceTimezone"
       ${joins}
       WHERE e.org_id = $1
         AND (e.rrule IS NOT NULL OR e.starts_at >= $2::timestamptz)
         AND e.starts_at < $3::timestamptz
       ORDER BY e.starts_at
       LIMIT $4`,
      [orgId, window.windowStart, window.windowEnd, MAX_OVERLAY_MEETINGS],
    );
    rows = result.rows;
  } catch {
    // Pre-0456 database: no recurrence columns. The overlay still works, it
    // just shows the stored rows — which is what that database has.
    const result = await client.query<OverlayEventRow>(
      `SELECT ${columns}, NULL::text AS "rrule", NULL::text AS "recurrenceEnd",
              NULL::text AS "seriesId", NULL::text AS "recurrenceTimezone"
       ${joins}
       WHERE e.org_id = $1 AND e.starts_at >= $2::timestamptz AND e.starts_at < $3::timestamptz
       ORDER BY e.starts_at
       LIMIT $4`,
      [orgId, window.windowStart, window.windowEnd, MAX_OVERLAY_MEETINGS],
    );
    rows = result.rows;
  }

  const exceptions = await withSavepoint(
    client,
    async () => {
      const result = await client.query<StoredException>(
        `SELECT series_id AS "seriesId", occurrence_date::text AS "occurrenceDate",
                action, detached_event_id AS "detachedEventId"
         FROM calendar_event_exceptions
         WHERE org_id = $1`,
        [orgId],
      );
      return result.rows;
    },
    [] as StoredException[],
  );

  const expanded = expandSeriesRows(rows, exceptions, window);
  const meetings: OverlayMeeting[] = [];
  for (const row of rows) {
    const occurrences = expanded.get(row.id);
    if (!occurrences) {
      // A one-off, or a detached override that already stands on its own.
      meetings.push(strip(row, row.startsAt, row.endsAt, row.id));
      continue;
    }
    for (const occurrence of occurrences) {
      if (meetings.length >= MAX_OVERLAY_MEETINGS) break;
      meetings.push(strip(row, occurrence.startsAt, occurrence.endsAt, occurrence.id));
    }
  }
  return meetings.slice(0, MAX_OVERLAY_MEETINGS);
}

/** An event row reduced to the six fields the season grid draws. */
function strip(
  row: OverlayEventRow,
  startsAt: string,
  endsAt: string | null,
  id: string,
): OverlayMeeting {
  return {
    id,
    title: row.title,
    startsAt,
    endsAt,
    subteamName: row.subteamName,
    subteamColor: row.subteamColor,
  };
}

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const url = new URL(request.url);
    const requestedOrg = url.searchParams.get("orgId");

    const view = await withRls({ userId: session.user.id, orgId: requestedOrg ?? undefined }, async (client) => {
      const membership = await client.query<{
        orgId: string;
        orgName: string;
        teamNumber: number | null;
        role: string;
      }>(
        `SELECT m.org_id AS "orgId", o.name AS "orgName", o.team_number AS "teamNumber", m.role
         FROM memberships m
         JOIN organizations o ON o.id = m.org_id
         WHERE m.user_id = $1 AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
         ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
         LIMIT 1`,
        [session.user.id, requestedOrg],
      );

      const row = membership.rows[0];
      if (!row) {
        if (requestedOrg) throw new HttpError(403, "Organization access denied");
        return {
          status: "setup_required",
          message: "Choose your team to plan your season calendar.",
          context: { orgId: null, orgName: null, teamNumber: null, role: null },
        } satisfies CalendarView;
      }

      const milestones = await client.query<Milestone>(
        `SELECT s.id, s.title, s.kind, s.starts_on::text AS "startsOn", s.ends_on::text AS "endsOn",
                s.notes, s.meeting_url AS "meetingUrl", s.series_id AS "seriesId",
                s.done, s.done_at::text AS "doneAt", db.name AS "doneByName", cb.name AS "createdByName"
         FROM season_milestones s
         LEFT JOIN users db ON db.id = s.done_by
         LEFT JOIN users cb ON cb.id = s.created_by
         WHERE s.org_id = $1
         ORDER BY s.starts_on, s.created_at
         LIMIT 500`,
        [row.orgId],
      );

      // Business tables may be absent in partial local setups — calendar still
      // works. Savepointed so that is true of the sections after it as well.
      const linkedDeadlines: LinkedDeadline[] = await withSavepoint(
        client,
        () => loadLinkedDeadlines(client, row.orgId),
        [],
      );

      // Savepointed for the same reason: a database without the team calendar
      // tables is a partial setup, not a broken season calendar.
      const meetings: OverlayMeeting[] = await withSavepoint(
        client,
        () => loadMeetingOverlay(client, row.orgId),
        [],
      );

      return {
        status: "ready",
        context: {
          orgId: row.orgId,
          orgName: row.orgName,
          teamNumber: row.teamNumber,
          role: row.role,
        },
        milestones: milestones.rows,
        linkedDeadlines,
        meetings,
        templates: listSeasonTemplates(),
      } satisfies CalendarView;
    });

    return Response.json(view);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const action = parseCalendarAction(await request.json());
    const userId = session.user.id;

    const result = await withRls({ userId, orgId: action.orgId }, async (client) => {
      await requireMembership(client, action.orgId, userId);

      switch (action.action) {
        case "seed_season": {
          const existing = await client.query<{ title: string }>(
            `SELECT title FROM season_milestones WHERE org_id = $1`,
            [action.orgId],
          );
          const taken = new Set(existing.rows.map((existingRow) => existingRow.title));
          let added = 0;
          for (const seed of seedFromKickoff(action.kickoffDate, action.templateId)) {
            if (taken.has(seed.title)) continue;
            await client.query(
              `INSERT INTO season_milestones (org_id, title, kind, starts_on, ends_on, notes, created_by)
               VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [action.orgId, seed.title, seed.kind, seed.startsOn, seed.endsOn, seed.notes, userId],
            );
            added += 1;
          }
          return { added, templateId: action.templateId };
        }

        case "add_milestone": {
          /**
           * One row per date, in one statement.
           *
           * A practice schedule is forty entries, and forty round trips from a
           * phone on venue Wi-Fi is a different feature from one. `unnest`
           * expands the date array server-side so the whole series is one
           * insert and one transaction — either the schedule is there or none
           * of it is, rather than a half-written season to clean up.
           *
           * `repeatOn` always contains the start date, so the plain
           * single-entry path runs through here unchanged.
           */
          const span =
            action.endsOn && action.startsOn
              ? Date.parse(`${action.endsOn}T00:00:00Z`) - Date.parse(`${action.startsOn}T00:00:00Z`)
              : null;
          const endsFor = (startsOn: string) =>
            span != null && span > 0
              ? new Date(Date.parse(`${startsOn}T00:00:00Z`) + span).toISOString().slice(0, 10)
              : action.endsOn;

          const starts = action.repeatOn;
          const ends = starts.map(endsFor);
          /*
            A series id, only when one press made more than one entry.

            It records which press created these rows and nothing else — no
            cadence, no end date, no exceptions — so there is no rule that can
            drift out of step with the entries. The entries stay the truth;
            this only makes "undo that whole schedule" one action instead of
            forty. A single entry gets NULL, because a series of one is a
            concept nobody needs.

            Generated in Postgres rather than here so the id comes from the
            same place every other id in this table does.
          */
          const asSeries = starts.length > 1;
          const inserted = await client.query<{ id: string; seriesId: string | null }>(
            `WITH s AS (SELECT CASE WHEN $9::boolean THEN gen_random_uuid() END AS series_id)
             INSERT INTO season_milestones
               (org_id, title, kind, starts_on, ends_on, notes, meeting_url, created_by, series_id)
             SELECT $1, $2, $3, d.starts_on::date, NULLIF(d.ends_on, '')::date, $6, $7, $8, s.series_id
               FROM unnest($4::text[], $5::text[]) AS d(starts_on, ends_on), s
             RETURNING id, series_id AS "seriesId"`,
            [
              action.orgId,
              action.title,
              action.kind,
              starts,
              ends.map((value) => value ?? ""),
              action.notes,
              action.meetingUrl,
              userId,
              asSeries,
            ],
          );
          return {
            id: inserted.rows[0]!.id,
            added: inserted.rowCount ?? 0,
            seriesId: inserted.rows[0]?.seriesId ?? null,
          };
        }

        case "delete_series": {
          // Every entry one press created, including the ones somebody has
          // since moved or renamed. "Created together" stays true however an
          // entry is edited afterwards, and a team deleting the practice
          // schedule does mean the Tuesday that moved to Wednesday as well.
          const removed = await client.query(
            `DELETE FROM season_milestones WHERE org_id = $1 AND series_id = $2::uuid`,
            [action.orgId, action.seriesId],
          );
          return { deleted: removed.rowCount ?? 0 };
        }

        case "update_milestone": {
          const values: unknown[] = [action.id, action.orgId];
          const sets: string[] = [];
          const push = (column: string, value: unknown) => {
            values.push(value);
            sets.push(`${column} = $${values.length}`);
          };
          const patch = action.patch;
          if (Object.prototype.hasOwnProperty.call(patch, "title")) push("title", patch.title);
          if (Object.prototype.hasOwnProperty.call(patch, "kind")) push("kind", patch.kind);
          if (Object.prototype.hasOwnProperty.call(patch, "startsOn")) push("starts_on", patch.startsOn);
          if (Object.prototype.hasOwnProperty.call(patch, "endsOn")) push("ends_on", patch.endsOn);
          if (Object.prototype.hasOwnProperty.call(patch, "notes")) push("notes", patch.notes);
          if (Object.prototype.hasOwnProperty.call(patch, "meetingUrl")) push("meeting_url", patch.meetingUrl);
          const updated = await client.query(
            `UPDATE season_milestones SET ${sets.join(", ")}, updated_at = now() WHERE id = $1 AND org_id = $2`,
            values,
          );
          if (!updated.rowCount) throw new HttpError(404, "Milestone not found");
          return { ok: true };
        }

        case "toggle_done": {
          const updated = await client.query(
            `UPDATE season_milestones
             SET done = $3,
                 done_at = CASE WHEN $3 THEN now() ELSE NULL END,
                 done_by = CASE WHEN $3 THEN $4::uuid ELSE NULL END,
                 updated_at = now()
             WHERE id = $1 AND org_id = $2`,
            [action.id, action.orgId, action.done, userId],
          );
          if (!updated.rowCount) throw new HttpError(404, "Milestone not found");
          return { ok: true };
        }

        case "delete_milestone": {
          const deleted = await client.query(`DELETE FROM season_milestones WHERE id = $1 AND org_id = $2`, [
            action.id,
            action.orgId,
          ]);
          if (!deleted.rowCount) throw new HttpError(404, "Milestone not found");
          return { ok: true };
        }

        default:
          throw new HttpError(400, "Unsupported calendar action");
      }
    });

    return Response.json(result);
  } catch (error) {
    return fail(error);
  }
}
