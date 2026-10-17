import type { PoolClient } from "@neondatabase/serverless";
import { withSavepoint } from "@vantage/db";
import { groupAllianceSlots, type BoardSlotRow, type PlayoffAlliancesView } from "./alliances";

/**
 * The board for the team's active event: a locked one first (selection is over), else the one
 * edited most recently. Two small indexed reads; members can read the board (0418 policies).
 */
export async function loadPlayoffAlliances(client: PoolClient, orgId: string): Promise<PlayoffAlliancesView> {
  const context = await client.query<{ eventKey: string | null }>(
    `SELECT active_event_key AS "eventKey" FROM org_active_context WHERE org_id = $1::uuid`,
    [orgId],
  );
  const eventKey = context.rows[0]?.eventKey ?? null;
  if (!eventKey) return { status: "empty", eventKey: null };
  const rows = await withSavepoint(
    client,
    async () =>
      (
        await client.query<BoardSlotRow & { boardName: string; updatedAt: string }>(
          `WITH board AS (
             SELECT id, name, updated_at
               FROM alliance_selection_desk_sessions
              WHERE org_id = $1::uuid AND event_key = $2::text
              ORDER BY (status = 'locked') DESC, updated_at DESC
              LIMIT 1
           )
           SELECT board.name AS "boardName", board.updated_at::text AS "updatedAt",
                  slot.alliance_seed AS "allianceSeed", slot.pick_slot AS "pickSlot", slot.team_key AS "teamKey"
             FROM board
             LEFT JOIN alliance_selection_desk_slots slot
               ON slot.session_id = board.id AND slot.org_id = $1::uuid`,
          [orgId, eventKey],
        )
      ).rows,
    // A database without the board tables yet has no board, not an error.
    [] as Array<BoardSlotRow & { boardName: string; updatedAt: string }>,
  );
  const alliances = groupAllianceSlots(rows);
  if (!rows[0] || alliances.length < 2) return { status: "empty", eventKey };
  return { status: "ready", eventKey, boardName: rows[0].boardName, updatedAt: rows[0].updatedAt, alliances };
}
