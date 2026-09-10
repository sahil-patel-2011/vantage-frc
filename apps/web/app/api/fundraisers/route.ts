import type { PoolClient } from "@neondatabase/serverless";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { parseFundraiserAction, summarizeFundraisers, type FundraiserStatus, type FundraiserType } from "../../../lib/fundraisers";
import { syncFundraiserMoney } from "../../../lib/finance/source-mirrors";

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
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

async function requireAdmin(client: PoolClient, orgId: string, userId: string) {
  const row = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2 AND role IN ('owner', 'admin') LIMIT 1`, [orgId, userId]);
  if (!row.rowCount) throw new HttpError(403, "Organization administrator access required to record money");
}

function fail(error: unknown) {
  const status = error instanceof HttpError ? error.status : 400;
  return Response.json({ error: error instanceof Error ? error.message : "Fundraiser request failed" }, { status });
}

type EventRow = {
  id: string; seasonYear: number; name: string; type: FundraiserType; eventDate: string;
  goalUsd: number | null; proceedsUsd: number; status: FundraiserStatus; location: string; notes: string; byName: string | null;
};

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const url = new URL(request.url);
    const requestedOrg = url.searchParams.get("orgId");
    const seasonYear = Number(url.searchParams.get("seasonYear") ?? new Date().getFullYear());

    const view = await withRls({ userId: session.user.id }, async (client) => {
      const membership = await client.query<{ orgId: string; orgName: string; role: string }>(
        `SELECT m.org_id AS "orgId", o.name AS "orgName", m.role
         FROM memberships m JOIN organizations o ON o.id = m.org_id
         WHERE m.user_id = $1 AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
         ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
         LIMIT 1`,
        [session.user.id, requestedOrg],
      );
      const row = membership.rows[0];
      if (!row) return { status: "setup_required" as const, message: "Choose your team to plan fundraisers." };

      const events = await client.query<EventRow>(
        `SELECT e.id, e.season_year AS "seasonYear", e.name, e.type, e.event_date::text AS "eventDate",
                e.goal_usd::float8 AS "goalUsd", e.proceeds_usd::float8 AS "proceedsUsd", e.status,
                e.location, e.notes, u.name AS "byName"
         FROM fundraiser_events e LEFT JOIN users u ON u.id = e.created_by
         WHERE e.org_id = $1 AND e.season_year = $2 ORDER BY e.event_date DESC`,
        [row.orgId, seasonYear],
      );

      const summary = summarizeFundraisers(events.rows.map((e) => ({ status: e.status, goalUsd: e.goalUsd, proceedsUsd: e.proceedsUsd })));
      return {
        status: "ready" as const,
        context: { orgId: row.orgId, orgName: row.orgName, role: row.role },
        seasonYear,
        events: events.rows,
        summary,
      };
    });

    return Response.json(view);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const action = parseFundraiserAction(await request.json());
    const userId = session.user.id;

    const result = await withRls({ userId, orgId: action.orgId }, async (client) => {
      await requireMembership(client, action.orgId, userId);

      switch (action.action) {
        case "create_event": {
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO fundraiser_events (org_id, season_year, name, type, event_date, goal_usd, location, notes, created_by)
             VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8, $9) RETURNING id`,
            [action.orgId, action.seasonYear, action.name, action.type, action.eventDate, action.goalUsd, action.location, action.notes, userId],
          );
          return { id: inserted.rows[0]!.id };
        }
        case "set_status": {
          const current = await client.query<{ proceedsUsd: string }>(
            `SELECT proceeds_usd::text AS "proceedsUsd" FROM fundraiser_events WHERE id = $1 AND org_id = $2`,
            [action.id, action.orgId],
          );
          if (!current.rows[0]) throw new HttpError(404, "Fundraiser not found");
          if (Number(current.rows[0].proceedsUsd) > 0) {
            await requireAdmin(client, action.orgId, userId);
          }
          const updated = await client.query<{
            seasonYear: number;
            name: string;
            proceedsUsd: string;
            eventDate: string;
            status: string;
          }>(
            `UPDATE fundraiser_events SET status = $1, updated_at = now() WHERE id = $2 AND org_id = $3
             RETURNING season_year AS "seasonYear", name, proceeds_usd::text AS "proceedsUsd",
                       event_date::text AS "eventDate", status`,
            [action.status, action.id, action.orgId],
          );
          if (!updated.rowCount) throw new HttpError(404, "Fundraiser not found");
          const row = updated.rows[0]!;
          await syncFundraiserMoney(client, {
            orgId: action.orgId,
            fundraiserId: action.id,
            seasonYear: row.seasonYear,
            name: row.name,
            proceedsUsd: Number(row.proceedsUsd) || 0,
            eventDate: row.eventDate,
            status: row.status,
            userId,
          });
          return { ok: true };
        }
        case "record_proceeds": {
          await requireAdmin(client, action.orgId, userId);
          const event = await client.query<{
            seasonYear: number;
            name: string;
            proceedsUsd: string;
            eventDate: string;
            status: string;
          }>(
            `UPDATE fundraiser_events SET proceeds_usd = proceeds_usd + $1, updated_at = now()
             WHERE id = $2 AND org_id = $3
             RETURNING season_year AS "seasonYear", name, proceeds_usd::text AS "proceedsUsd",
                       event_date::text AS "eventDate", status`,
            [action.amountUsd, action.id, action.orgId],
          );
          if (!event.rowCount) throw new HttpError(404, "Fundraiser not found");
          const row = event.rows[0]!;
          // One idempotent mirror per event carries the cumulative gross. A
          // second deposit updates that row instead of double-counting it.
          await syncFundraiserMoney(client, {
            orgId: action.orgId,
            fundraiserId: action.id,
            seasonYear: row.seasonYear,
            name: row.name,
            proceedsUsd: Number(row.proceedsUsd) || 0,
            eventDate: row.eventDate,
            status: row.status,
            userId,
          });
          return { ok: true };
        }
        case "delete_event": {
          const deleted = await client.query(`DELETE FROM fundraiser_events WHERE id = $1 AND org_id = $2`, [action.id, action.orgId]);
          if (!deleted.rowCount) throw new HttpError(403, "You cannot delete this fundraiser");
          await syncFundraiserMoney(client, {
            orgId: action.orgId,
            fundraiserId: action.id,
            seasonYear: new Date().getUTCFullYear(),
            name: "Removed fundraiser",
            proceedsUsd: 0,
            status: "cancelled",
            userId,
          });
          return { ok: true };
        }
        default:
          throw new HttpError(400, "Unsupported fundraiser action");
      }
    });

    return Response.json(result);
  } catch (error) {
    return fail(error);
  }
}
