import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  customEventKey,
  customEventProblemCopy,
  validateCustomEvent,
} from "../../../../lib/events/custom-event";

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
    const year = yearParam ? Number(yearParam) : new Date().getFullYear();
    if (!orgId) throw new Error("orgId is required");
    if (!Number.isFinite(year)) throw new Error("year must be a number");

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

      const events = await client.query<{
        eventKey: string;
        name: string;
        startDate: string | null;
        endDate: string | null;
        city: string | null;
        stateProv: string | null;
        year: number;
        custom: boolean;
      }>(
        // org_id is read through to_jsonb so this keeps working on a deploy that
        // briefly runs ahead of the custom-events migration: a missing column
        // reads as NULL instead of raising, and every row simply looks shared.
        `SELECT event_key AS "eventKey", name, start_date::text AS "startDate", end_date::text AS "endDate",
                city, state_prov AS "stateProv", year,
                (to_jsonb(events_ref) ->> 'org_id') IS NOT NULL AS custom
         FROM events_ref
         WHERE year = $1
           AND (
             $2::text = ''
             OR event_key ILIKE '%' || $2 || '%'
             OR name ILIKE '%' || $2 || '%'
             OR COALESCE(city, '') ILIKE '%' || $2 || '%'
           )
         ORDER BY (to_jsonb(events_ref) ->> 'org_id') IS NOT NULL DESC,
                  start_date NULLS LAST, name
         LIMIT 40`,
        [year, q],
      );

      return {
        role: membership.rows[0]!.role,
        activeEventKey: membership.rows[0]!.eventKey,
        canSetEvent: ["owner", "admin"].includes(membership.rows[0]!.role),
        year,
        events: events.rows,
      };
    });

    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not list events" },
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
      /**
       * An event this team runs that TBA does not list — an offseason like
       * GRITS, or any regional equivalent. Creating one also makes it active,
       * because nobody adds an event they are not about to use.
       */
      create?: {
        name?: string;
        year?: number;
        startDate?: string | null;
        endDate?: string | null;
        city?: string | null;
        stateProv?: string | null;
        country?: string | null;
      };
    };
    const orgId = body.orgId;
    if (!orgId) throw new Error("orgId is required");
    const creating = body.create;
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
      if (!["owner", "admin"].includes(membership.rows[0]!.role)) {
        throw new Error("Owner or admin role required to set the active event");
      }

      let activeKey = eventKey;

      if (creating) {
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
             event_type, org_id, created_by
           ) VALUES ($1, $2, $3, $4::date, $5::date, $6, $7, $8, 99, $9::uuid, $10::uuid)
           ON CONFLICT (event_key) DO UPDATE SET
             name = EXCLUDED.name,
             start_date = EXCLUDED.start_date,
             end_date = EXCLUDED.end_date,
             city = EXCLUDED.city,
             state_prov = EXCLUDED.state_prov,
             country = EXCLUDED.country`,
          [
            activeKey,
            draft.year,
            draft.name,
            draft.startDate || null,
            draft.endDate || null,
            creating.city?.trim() || null,
            creating.stateProv?.trim() || null,
            creating.country?.trim() || null,
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
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not set active event" },
      { status: 400 },
    );
  }
}
