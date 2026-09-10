import { createHash, randomBytes } from "node:crypto";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { recommendNextPick, type PickClockListHint } from "../../../../lib/strategy/pick-clock";
import {
  emptyAllianceBoardState,
  loadPickDesk,
  normalizeAllianceBoardState,
  type AllianceBoardState,
  type AllianceSlot,
} from "../../../../lib/strategy/pick-desk";

function takenFromAlliances(alliances: AllianceSlot[]): string[] {
  const keys: string[] = [];
  for (const alliance of alliances) {
    for (const key of [alliance.captainTeamKey, alliance.firstPickTeamKey, alliance.secondPickTeamKey]) {
      if (key) keys.push(key);
    }
  }
  return keys;
}

async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  return session;
}

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    const boardId = url.searchParams.get("boardId");
    const eventKey = url.searchParams.get("eventKey");

    const data = await withRls({ userId: session.user.id, orgId: orgId ?? undefined }, async (client) => {
      const membership = await client.query<{
        orgId: string;
        eventKey: string | null;
        eventName: string | null;
        role: string;
      }>(
        `SELECT m.org_id AS "orgId", c.active_event_key AS "eventKey", e.name AS "eventName", m.role::text AS role
         FROM memberships m
         LEFT JOIN org_active_context c ON c.org_id = m.org_id
         LEFT JOIN events_ref e ON e.event_key = c.active_event_key
         WHERE m.user_id = $1 AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
         ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END
         LIMIT 1`,
        [session.user.id, orgId],
      );
      const row = membership.rows[0];
      if (!row?.orgId) return { error: "workspace_required" as const };

      const activeEvent = eventKey ?? row.eventKey;
      if (!activeEvent) return { error: "event_required" as const, orgId: row.orgId };

      const teamKeys = (
        await client.query<{ teamKey: string }>(
          `SELECT DISTINCT team_key AS "teamKey" FROM team_event_metrics WHERE event_key = $1`,
          [activeEvent],
        )
      ).rows.map((item) => item.teamKey);

      let board = boardId
        ? (
            await client.query<{
              id: string;
              name: string;
              eventKey: string;
              pickListId: string | null;
              state: unknown;
              updatedAt: string | null;
            }>(
              `SELECT id, name, event_key AS "eventKey", pick_list_id AS "pickListId",
                      state, updated_at::text AS "updatedAt"
               FROM alliance_boards WHERE id = $1::uuid AND org_id = $2`,
              [boardId, row.orgId],
            )
          ).rows[0]
        : (
            await client.query<{
              id: string;
              name: string;
              eventKey: string;
              pickListId: string | null;
              state: unknown;
              updatedAt: string | null;
            }>(
              `SELECT id, name, event_key AS "eventKey", pick_list_id AS "pickListId",
                      state, updated_at::text AS "updatedAt"
               FROM alliance_boards
               WHERE org_id = $1 AND event_key = $2
               ORDER BY updated_at DESC
               LIMIT 1`,
              [row.orgId, activeEvent],
            )
          ).rows[0];

      const canEdit = row.role === "owner" || row.role === "admin";
      if (!board && canEdit) {
        const seedState = emptyAllianceBoardState(teamKeys);
        const inserted = await client.query<{
          id: string;
          name: string;
          eventKey: string;
          pickListId: string | null;
          state: unknown;
          updatedAt: string | null;
        }>(
          `INSERT INTO alliance_boards(org_id, event_key, name, state, created_by)
           VALUES ($1, $2, $3, $4::jsonb, $5)
           ON CONFLICT (org_id, event_key, name) DO UPDATE SET updated_at = alliance_boards.updated_at
           RETURNING id, name, event_key AS "eventKey", pick_list_id AS "pickListId",
                     state, updated_at::text AS "updatedAt"`,
          [row.orgId, activeEvent, "Draft day", JSON.stringify(seedState), session.user.id],
        );
        board = inserted.rows[0];
      }

      if (!board) {
        return {
          orgId: row.orgId,
          eventKey: activeEvent,
          eventName: row.eventName,
          canEdit,
          board: null,
          teamKeys,
          pickLists: (
            await client.query<{ id: string; name: string }>(
              `SELECT id, name FROM pick_lists WHERE org_id = $1 AND event_key = $2 ORDER BY updated_at DESC`,
              [row.orgId, activeEvent],
            )
          ).rows,
          shareTokens: [],
          message: canEdit
            ? "Could not create draft board."
            : "No draft board yet — an owner or admin needs to open Draft day first.",
        };
      }

      const state = normalizeAllianceBoardState(board.state, teamKeys);
      const tokens = await client.query<{
        id: string;
        expiresAt: string;
        revokedAt: string | null;
        lastUsedAt: string | null;
      }>(
        `SELECT id, expires_at::text AS "expiresAt", revoked_at::text AS "revokedAt",
                last_used_at::text AS "lastUsedAt"
         FROM alliance_board_share_tokens
         WHERE board_id = $1 AND org_id = $2
         ORDER BY created_at DESC
         LIMIT 8`,
        [board.id, row.orgId],
      );

      const pickLists = await client.query<{ id: string; name: string }>(
        `SELECT id, name FROM pick_lists WHERE org_id = $1 AND event_key = $2 ORDER BY updated_at DESC`,
        [row.orgId, board.eventKey],
      );

      const desk = await loadPickDesk(client, {
        userId: session.user.id,
        requestedOrg: row.orgId,
      });
      let pickAssist: {
        pickMode: "full" | "low_data_tba";
        pickModeReason: string | null;
        scoutedTeams: number;
        teamCount: number;
        recommendation: ReturnType<typeof recommendNextPick>["recommendation"];
        alternates: ReturnType<typeof recommendNextPick>["alternates"];
        epaDrifts: Array<{ teamKey: string; label: string; delta: number; divergent: boolean }>;
      } | null = null;
      if (!("status" in desk)) {
        const excludedTeamKeys = takenFromAlliances(state.alliances);
        const linkedList =
          desk.pickLists.find((list) => list.id === (state.pickListId ?? board.pickListId)) ??
          desk.pickLists[0] ??
          null;
        const pickListEntries: PickClockListHint[] = linkedList
          ? linkedList.entries.map((entry) => ({
              teamKey: entry.teamKey,
              rank: entry.rank,
              tier: entry.tier,
              notes: entry.notes,
              listName: linkedList.name,
            }))
          : [];
        const clock = recommendNextPick({
          candidates: desk.candidates,
          excludedTeamKeys,
          pickListEntries,
          alternateCount: 4,
          pickMode: desk.pickMode,
          epaDrifts: desk.epaDrifts,
        });
        pickAssist = {
          pickMode: desk.pickMode,
          pickModeReason: desk.pickModeReason,
          scoutedTeams: desk.scoutedTeams,
          teamCount: desk.teamCount,
          recommendation: clock.recommendation,
          alternates: clock.alternates,
          epaDrifts: desk.epaDrifts
            .filter((item) => !excludedTeamKeys.includes(item.teamKey))
            .slice(0, 8)
            .map((item) => ({
              teamKey: item.teamKey,
              label: item.label,
              delta: item.delta,
              divergent: item.divergent,
            })),
        };
      }

      return {
        orgId: row.orgId,
        eventKey: board.eventKey,
        eventName: row.eventName,
        canEdit,
        board: {
          id: board.id,
          name: board.name,
          pickListId: board.pickListId,
          updatedAt: board.updatedAt,
          state,
        },
        teamKeys,
        pickLists: pickLists.rows,
        shareTokens: tokens.rows,
        pickAssist,
      };
    });

    if ("error" in data) {
      return Response.json(
        {
          status: "setup_required",
          message:
            data.error === "event_required"
              ? "Select an active event before opening draft day."
              : "Select a team to open the alliance board.",
          orgId: "orgId" in data ? data.orgId : null,
        },
        { status: 200 },
      );
    }
    return Response.json(data);
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json({ error: "Could not load alliance board" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const body = (await request.json()) as {
      orgId?: string;
      boardId?: string;
      action?: "save" | "share" | "revoke-share" | "reset";
      name?: string;
      state?: AllianceBoardState;
      pickListId?: string | null;
      tokenId?: string;
    };
    if (!body.orgId) return Response.json({ error: "orgId is required" }, { status: 400 });
    const action = body.action ?? "save";

    const result = await withRls(
      { userId: session.user.id, orgId: body.orgId },
      async (client) => {
        const role = await client.query<{ ok: boolean }>(
          `SELECT EXISTS(
             SELECT 1 FROM memberships
             WHERE org_id = $1::uuid AND user_id = $2
               AND role IN ('owner', 'admin')
           ) AS ok`,
          [body.orgId, session.user.id],
        );
        if (!role.rows[0]?.ok) throw new Error("Owner or admin role required for draft day edits");

        if (action === "revoke-share") {
          if (!body.tokenId) throw new Error("tokenId is required");
          await client.query(
            `UPDATE alliance_board_share_tokens SET revoked_at = now()
             WHERE id = $1::uuid AND org_id = $2::uuid`,
            [body.tokenId, body.orgId],
          );
          return { success: true };
        }

        if (action === "share") {
          if (!body.boardId) throw new Error("boardId is required");
          const owned = await client.query(
            `SELECT 1 FROM alliance_boards WHERE id = $1::uuid AND org_id = $2::uuid`,
            [body.boardId, body.orgId],
          );
          if (!owned.rowCount) throw new Error("Alliance board not found");
          const token = randomBytes(32).toString("base64url");
          await client.query(
            `INSERT INTO alliance_board_share_tokens(org_id, board_id, token_hash, created_by, expires_at)
             VALUES ($1::uuid, $2::uuid, $3, $4, now() + interval '14 days')`,
            [
              body.orgId,
              body.boardId,
              createHash("sha256").update(token).digest("hex"),
              session.user.id,
            ],
          );
          return {
            token,
            url: `/strategy/board?token=${encodeURIComponent(token)}`,
          };
        }

        if (!body.boardId) throw new Error("boardId is required");
        const existing = await client.query<{ eventKey: string; state: unknown }>(
          `SELECT event_key AS "eventKey", state FROM alliance_boards
           WHERE id = $1::uuid AND org_id = $2::uuid`,
          [body.boardId, body.orgId],
        );
        const board = existing.rows[0];
        if (!board) throw new Error("Alliance board not found");

        const teamKeys = (
          await client.query<{ teamKey: string }>(
            `SELECT DISTINCT team_key AS "teamKey" FROM team_event_metrics WHERE event_key = $1`,
            [board.eventKey],
          )
        ).rows.map((item) => item.teamKey);

        const nextState =
          action === "reset"
            ? emptyAllianceBoardState(teamKeys)
            : normalizeAllianceBoardState(body.state ?? board.state, teamKeys);

        if (body.pickListId !== undefined) nextState.pickListId = body.pickListId;

        await client.query(
          `UPDATE alliance_boards
           SET name = COALESCE($3, name),
               pick_list_id = $4::uuid,
               state = $5::jsonb,
               updated_at = now()
           WHERE id = $1::uuid AND org_id = $2::uuid`,
          [
            body.boardId,
            body.orgId,
            body.name?.trim() || null,
            nextState.pickListId,
            JSON.stringify(nextState),
          ],
        );
        return { success: true, state: nextState };
      },
    );

    return Response.json(result);
  } catch (error) {
    if (error instanceof Response) return error;
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not update alliance board" },
      { status: 400 },
    );
  }
}
