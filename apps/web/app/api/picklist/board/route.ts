// Draft-board projection off the ONE pick list.
//
// Pick Clock reads this so a team the alliance-selection desk already drafted stops being
// recommended: `draftedTeamKeys` feeds straight into /api/strategy/pick-clock's `exclude` params.
// Read-only; the board is written through /api/picklist (action: set-board-slot).

import type { PoolClient } from "@neondatabase/serverless";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { boardState, type BoardStateView } from "../../../../lib/picklist";

export type PickListBoardResponse =
  | { status: "empty"; orgId: string | null; eventKey: string | null; draftedTeamKeys: [] }
  | { status: "ready"; orgId: string; eventKey: string; board: BoardStateView; draftedTeamKeys: string[] };

async function resolveContext(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
): Promise<{ orgId: string; eventKey: string | null } | null> {
  const result = await client.query<{ orgId: string; eventKey: string | null }>(
    `SELECT m.org_id AS "orgId", c.active_event_key AS "eventKey"
     FROM memberships m
     JOIN organizations o ON o.id = m.org_id
     LEFT JOIN org_active_context c ON c.org_id = o.id
     WHERE m.user_id = $1::uuid
       AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
     LIMIT 1`,
    [userId, requestedOrg],
  );
  return result.rows[0] ?? null;
}

const EMPTY: PickListBoardResponse = {
  status: "empty",
  orgId: null,
  eventKey: null,
  draftedTeamKeys: [],
};

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");
  const pickListId = url.searchParams.get("pickListId");
  const eventKeyParam = url.searchParams.get("eventKey");

  try {
    const payload = await withRls({ userId: session.user.id }, async (client) => {
      const context = await resolveContext(client, session.user.id, requestedOrg);
      if (!context) return EMPTY;

      const eventKey = eventKeyParam ?? context.eventKey;
      const board = await boardState(client, {
        orgId: context.orgId,
        pickListId,
        eventKey: pickListId ? null : eventKey,
      });
      if (!board) {
        return {
          status: "empty" as const,
          orgId: context.orgId,
          eventKey,
          draftedTeamKeys: [] as [],
        };
      }

      return {
        status: "ready" as const,
        orgId: context.orgId,
        eventKey: board.eventKey,
        board,
        draftedTeamKeys: board.draftedTeamKeys,
      };
    });

    return Response.json(payload);
  } catch {
    // No DB / no workspace yet — an honest empty board, never a fabricated one.
    return Response.json(EMPTY, { status: 200 });
  }
}
