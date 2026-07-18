import type { PoolClient } from "@neondatabase/serverless";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { countLodgingGaps } from "../../../lib/logistics";

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
  const message = error instanceof Error ? error.message : "Logistics request failed";
  if (/logistics_|relation .* does not exist/i.test(message)) {
    return Response.json({
      status: "setup_required",
      message: "Apply the event logistics migration first (0148_event_logistics).",
    });
  }
  const status = error instanceof HttpError ? error.status : 400;
  return Response.json({ error: message }, { status });
}

async function loadView(client: PoolClient, userId: string, requestedOrg: string | null) {
  const membership = await client.query<{
    orgId: string;
    teamRole: string | null;
  }>(
    `SELECT m.org_id AS "orgId", p.team_role AS "teamRole"
     FROM memberships m
     LEFT JOIN profiles p ON p.user_id = m.user_id
     WHERE m.user_id = $1 AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END
     LIMIT 1`,
    [userId, requestedOrg],
  );
  const org = membership.rows[0];
  if (!org) {
    return {
      status: "setup_required" as const,
      message: "Select a team workspace to view lodging and travel checklists.",
    };
  }

  const [trips, rooms, unsigned] = await Promise.all([
    client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM logistics_trips WHERE org_id = $1`,
      [org.orgId],
    ),
    client.query<{
      occupantUserId: string | null;
      occupantName: string;
      hotelName: string;
      roomLabel: string;
    }>(
      `SELECT r.occupant_user_id AS "occupantUserId", r.occupant_name AS "occupantName",
              h.name AS "hotelName", r.room_label AS "roomLabel"
       FROM logistics_room_assignments r
       JOIN logistics_hotels h ON h.id = r.hotel_id
       WHERE r.org_id = $1`,
      [org.orgId],
    ),
    client.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM logistics_checklist_items i
       WHERE i.org_id = $1
         AND NOT EXISTS (
           SELECT 1 FROM logistics_checklist_checks c
           WHERE c.item_id = i.id AND c.user_id = $2
         )`,
      [org.orgId, userId],
    ),
  ]);

  const mine = rooms.rows.find((room) => room.occupantUserId === userId);

  return {
    status: "ready" as const,
    orgId: org.orgId,
    teamRole: org.teamRole,
    lodgingGaps: countLodgingGaps(rooms.rows),
    myHotel: mine?.hotelName ?? null,
    myRoom: mine?.roomLabel ?? null,
    tripCount: Number(trips.rows[0]?.count ?? 0),
    unsignedForMe: Number(unsigned.rows[0]?.count ?? 0),
  };
}

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const requestedOrg = new URL(request.url).searchParams.get("orgId");
    const view = await withRls({ userId: session.user.id }, (client) =>
      loadView(client, session.user.id, requestedOrg),
    );
    return Response.json(view);
  } catch (error) {
    return fail(error);
  }
}
