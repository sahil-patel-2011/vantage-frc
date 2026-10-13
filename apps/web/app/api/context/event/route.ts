import { canManageScouting } from "@vantage/scouting/permissions";
import { assertOrgAuthentication, auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { cookies, headers } from "next/headers";
import {
  customEventKey,
  customEventProblemCopy,
  validateCustomEvent,
} from "../../../../lib/events/custom-event";
import { publicErrorMessage } from "../../../../lib/security/public-error";
import { organizerEvent, organizerEvents, parseCompetitionSchedule, parseEventYear, type PlannedCompetition } from "../../../../lib/events/event-planning";
import { notifyCalendarEvent } from "../../../../lib/notify-calendar";

async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Authentication required");
  return session;
}

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    const q = (url.searchParams.get("q") ?? "").trim();
    const yearParam = url.searchParams.get("year");
    const year = parseEventYear(yearParam);
    const scope = url.searchParams.get("scope") ?? "all";
    if (!orgId) throw new Error("orgId is required");

    const data = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const membership = await client.query<{ role: string; eventKey: string | null }>(
        `SELECT m.role, c.active_event_key AS "eventKey"
         FROM memberships m
         LEFT JOIN org_active_context c ON c.org_id = m.org_id
         WHERE m.org_id = $1 AND m.user_id = $2
         LIMIT 1`,
        [orgId, session.user.id],
      );
      if (!membership.rowCount) throw new Error("Organization membership required");

      const events = await client.query<PlannedCompetition>(
        `SELECT e.event_key AS "eventKey", e.name, e.start_date::text AS "startDate", e.end_date::text AS "endDate",
                e.city, e.state_prov AS "stateProv", e.year, e.event_type AS "eventType",
                e.org_id IS NOT NULL AS custom, c.id AS "calendarId",
                c.starts_at::text AS "plannedStart", c.ends_at::text AS "plannedEnd",
                c.competition_auto_activate AS "autoActivate"
                , COALESCE(c.recurrence_timezone, e.timezone) AS "timeZone"
         FROM events_ref e
         LEFT JOIN subteam_calendar_events c ON c.competition_event_key = e.event_key AND c.org_id = $3::uuid
         WHERE e.year = $1
           AND ($4 = 'all' OR ($4 = 'offseason' AND (e.event_type IN (99, 100) OR e.org_id IS NOT NULL))
             OR ($4 = 'saved' AND (c.id IS NOT NULL OR e.org_id = $3::uuid)))
           AND (
             $2::text = ''
             OR e.event_key ILIKE '%' || $2 || '%'
             OR e.name ILIKE '%' || $2 || '%'
             OR COALESCE(e.city, '') ILIKE '%' || $2 || '%'
           )
         ORDER BY c.id IS NOT NULL DESC, e.org_id IS NOT NULL DESC,
                  e.start_date NULLS LAST, e.name
         LIMIT 250`,
        [year, q, orgId, scope],
      );

      return {
        role: membership.rows[0]!.role,
        activeEventKey: membership.rows[0]!.eventKey,
        canSetEvent: await canManageScouting(client, orgId),
        year,
        events: [...(scope === "saved" ? [] : organizerEvents(year, q, events.rows)), ...events.rows.map(row => ({ ...row,
          plannedStart: row.plannedStart ? new Date(row.plannedStart).toISOString() : null,
          plannedEnd: row.plannedEnd ? new Date(row.plannedEnd).toISOString() : null,
        }))],
      };
    });

    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: publicErrorMessage(error, "Could not list events") },
      { status: 400 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const body = (await request.json()) as {
      orgId?: string;
      eventKey?: string | null;
      location?: string | null;
      intent?: "activate" | "save" | "schedule";
      catalogId?: string;
      schedule?: unknown;
      /**
       * An event this team runs that TBA does not list — an offseason like
       * GRITS, or any regional equivalent. Save ahead, schedule, or activate.
       */
      create?: {
        name?: string;
        year?: number;
        startDate?: string | null;
        endDate?: string | null;
        city?: string | null;
        stateProv?: string | null;
        country?: string | null;
        timeZone?: string | null;
      };
    };
    const orgId = body.orgId;
    if (!orgId) throw new Error("orgId is required");
    const catalog = body.catalogId ? organizerEvent(body.catalogId) : undefined;
    if (body.catalogId && !catalog) throw new Error("That organizer event is no longer listed. Add it by name instead.");
    const creating = catalog ?? body.create;
    const intent = body.intent ?? "activate";
    if (!["activate", "save", "schedule"].includes(intent)) throw new Error("Choose whether to save, schedule, or activate this event.");
    const schedule = intent === "schedule" ? parseCompetitionSchedule(body.schedule) : null;
    const eventKey = creating ? null : body.eventKey === undefined ? undefined : body.eventKey;
    if (!creating && eventKey === undefined) {
      throw new Error("eventKey is required (string or null to clear)");
    }

    const result = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const membership = await client.query<{ role: string }>(
        `SELECT role FROM memberships WHERE org_id = $1 AND user_id = $2 LIMIT 1`,
        [orgId, session.user.id],
      );
      if (!membership.rowCount) throw new Error("Organization membership required");
      if (!await canManageScouting(client, orgId)) {
        throw new Error("Scouting lead access required to set the active event");
      }
      // Scouting already refuses a sign-in method this team turned off. Setting
      // the event is the same kind of team change, so a password session cannot
      // do it while the rest of competition says to sign in again.
      await assertOrgAuthentication(client, {
        userId: session.user.id,
        orgId,
        sessionId: session.session.id,
        authMethod: String(
          (session.session as typeof session.session & { authMethod?: string }).authMethod ?? "unknown",
        ),
        rememberedDeviceToken: (await cookies()).get("vantage_mfa_device")?.value,
      });

      let activeKey = eventKey;

      if (creating) {
        if (creating.timeZone) {
          try { new Intl.DateTimeFormat("en", { timeZone: creating.timeZone }).format(); }
          catch { throw new Error("Choose a valid event time zone."); }
        }
        const draft = {
          name: (creating.name ?? "").trim(),
          year: Number(creating.year),
          startDate: creating.startDate ?? null,
          endDate: creating.endDate ?? null,
        };
        const problems = validateCustomEvent(draft);
        if (problems.length) {
          throw new Error(problems.map(customEventProblemCopy).join(" "));
        }
        activeKey = customEventKey(orgId, draft);
        // Re-adding the same event is how a team fixes a typo in the city, so
        // this updates rather than failing on the primary key. The RLS policy,
        // not this query, is what keeps one org out of another's rows.
        await client.query(
          `INSERT INTO events_ref (
             event_key, year, name, start_date, end_date, city, state_prov, country,
             timezone, event_type, org_id, created_by
           ) VALUES ($1, $2, $3, $4::date, $5::date, $6, $7, $8, $9, 99, $10::uuid, $11::uuid)
           ON CONFLICT (event_key) DO UPDATE SET
             name = EXCLUDED.name,
             start_date = COALESCE(EXCLUDED.start_date, events_ref.start_date),
             end_date = COALESCE(EXCLUDED.end_date, events_ref.end_date),
             city = COALESCE(EXCLUDED.city, events_ref.city),
             state_prov = COALESCE(EXCLUDED.state_prov, events_ref.state_prov),
             country = COALESCE(EXCLUDED.country, events_ref.country),
             timezone = COALESCE(EXCLUDED.timezone, events_ref.timezone)`,
          [
            activeKey,
            draft.year,
            draft.name,
            draft.startDate || null,
            draft.endDate || null,
            creating.city?.trim() || null,
            creating.stateProv?.trim() || null,
            ("country" in creating && typeof creating.country === "string" ? creating.country.trim() : null) || null,
            creating.timeZone || null,
            orgId,
            session.user.id,
          ],
        );
      } else if (activeKey) {
        const exists = await client.query(`SELECT 1 FROM events_ref WHERE event_key = $1`, [activeKey]);
        if (!exists.rowCount) {
          throw new Error("Unknown event key — sync TBA events before selecting.");
        }
      }

      if (intent !== "activate") {
        if (!activeKey) throw new Error("Choose an event to save.");
        const event = (await client.query<{ name: string; city: string | null; stateProv: string | null }>(
          `SELECT name, city, state_prov AS "stateProv" FROM events_ref WHERE event_key = $1`, [activeKey],
        )).rows[0];
        if (!event) throw new Error("This event is not available to your team.");
        let calendarId: string | null = null;
        if (schedule) {
          const location = body.location?.trim() || [event.city, event.stateProv].filter(Boolean).join(", ");
          // A retry or a save from the other entry point edits the same row.
          // Preserve its ID, attendance and RSVPs; do not create another event.
          const saved = await client.query<{ id: string }>(
            `INSERT INTO subteam_calendar_events
               (org_id, title, kind, starts_at, ends_at, location, created_by,
                competition_event_key, competition_auto_activate, recurrence_timezone)
             VALUES ($1, $2, 'event', $3::timestamptz, $4::timestamptz, $5, $6, $7, $8, $9)
             ON CONFLICT (org_id, competition_event_key) WHERE competition_event_key IS NOT NULL
             DO UPDATE SET title = EXCLUDED.title, starts_at = EXCLUDED.starts_at,
               ends_at = EXCLUDED.ends_at, location = EXCLUDED.location,
               competition_auto_activate = EXCLUDED.competition_auto_activate,
               recurrence_timezone = EXCLUDED.recurrence_timezone, updated_at = now()
             RETURNING id`,
            [orgId, event.name, schedule.startsAt, schedule.endsAt, location, session.user.id, activeKey, schedule.autoActivate, schedule.timeZone],
          );
          calendarId = saved.rows[0]!.id;
          await notifyCalendarEvent(client, { orgId, actorUserId: session.user.id, eventId: calendarId, title: event.name, subteamId: null, mode: "updated" });
          await client.query("SELECT activate_scheduled_competition_events($1::uuid)", [orgId]);
        }
        return { eventKey: activeKey, eventName: event.name, calendarId, scheduled: schedule != null };
      }

      await client.query(
        `INSERT INTO org_active_context (org_id, active_event_key, active_location, set_by_user_id, set_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (org_id) DO UPDATE SET
           active_event_key = EXCLUDED.active_event_key,
           active_location = COALESCE(EXCLUDED.active_location, org_active_context.active_location),
           set_by_user_id = EXCLUDED.set_by_user_id,
           set_at = now()`,
        [orgId, activeKey, body.location ?? null, session.user.id],
      );

      const context = await client.query<{
        eventKey: string | null;
        eventName: string | null;
        location: string | null;
        setAt: string;
      }>(
        `SELECT c.active_event_key AS "eventKey", e.name AS "eventName",
                c.active_location AS location, c.set_at::text AS "setAt"
         FROM org_active_context c
         LEFT JOIN events_ref e ON e.event_key = c.active_event_key
         WHERE c.org_id = $1`,
        [orgId],
      );

      return context.rows[0] ?? { eventKey: null, eventName: null, location: null, setAt: new Date().toISOString() };
    });

    return Response.json({ ok: true, ...result });
  } catch (error) {
    const code = error instanceof Error ? (error as Error & { code?: string }).code : undefined;
    const denied =
      code === "sign_in_method_not_allowed" ||
      code === "mfa_enrollment_required" ||
      code === "mfa_step_up_required";
    return Response.json(
      { error: publicErrorMessage(error, "Could not set active event") },
      { status: denied ? 403 : 400 },
    );
  }
}
