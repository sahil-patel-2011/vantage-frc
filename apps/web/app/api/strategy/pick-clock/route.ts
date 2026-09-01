// Pick Clock — recommend, then RECORD.
//
// GET  returns the next best pick plus the canonical draft board, excluding anything already
//      drafted on the ONE pick list (pick_list_entries.drafted_*, migration 0454). It no longer
//      reads the legacy alliance_boards jsonb, so the clock and the pick desk cannot disagree.
// POST records or undoes a pick against that same spine, then mirrors the slot onto
// alliance_boards.state so Draft day and the clock name the same occupant.

import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { recommendNextPick, type PickClockListHint } from "../../../../lib/strategy/pick-clock";
import { loadPickDesk } from "../../../../lib/strategy/pick-desk";
import {
  isValidBoardSlot,
  lastDraftedSlot,
  nextOpenBoardSlot,
  recordPickClockPick,
  undoPickClockPick,
  type BoardSlotRef,
} from "../../../../lib/strategy/pick-clock-board";
import { boardState } from "../../../../lib/picklist";
import { wirePickClockJustifications } from "../../../../lib/strategy/pick-clock-justifier-wire";
import { applyTeamTagReasonsToPickClock } from "../../../../lib/strategy/pick-clock-tag-reasons";

function trimmedOrNull(value: unknown, max = 200): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function slotFromBody(body: Record<string, unknown>): BoardSlotRef | null {
  const candidate = {
    allianceSeed: Number(body.allianceSeed),
    pickSlot: typeof body.pickSlot === "string" ? body.pickSlot : undefined,
  };
  return isValidBoardSlot(candidate) ? candidate : null;
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const orgId = url.searchParams.get("orgId");
  const extraExcluded = url.searchParams.getAll("exclude").filter(Boolean);

  try {
    const payload = await withRls(
      { userId: session.user.id, orgId: orgId ?? undefined },
      async (client) => {
        const desk = await loadPickDesk(client, {
          userId: session.user.id,
          requestedOrg: orgId,
        });
        if ("status" in desk) {
          return {
            status: "setup_required" as const,
            message: desk.message,
            orgId: desk.orgId,
            eventKey: desk.eventKey,
          };
        }

        // The ONE pick list owns the board, so drafted teams leave the clock's pool here.
        const board = await boardState(client, {
          orgId: desk.orgId,
          eventKey: desk.eventKey,
        });
        const excludedTeamKeys = [
          ...new Set([...(board?.draftedTeamKeys ?? []), ...extraExcluded]),
        ];

        const primaryList = desk.pickLists[0] ?? null;
        const pickListEntries: PickClockListHint[] = primaryList
          ? primaryList.entries.map((entry) => ({
              teamKey: entry.teamKey,
              rank: entry.rank,
              tier: entry.tier,
              notes: entry.notes,
              listName: primaryList.name,
            }))
          : [];

        const justified = await wirePickClockJustifications(
          client,
          recommendNextPick({
            candidates: desk.candidates,
            excludedTeamKeys,
            pickListEntries,
            alternateCount: 2,
            pickMode: desk.pickMode,
            epaDrifts: desk.epaDrifts,
          }),
          {
            orgId: desk.orgId,
            eventKey: desk.eventKey,
            pickListId: board?.pickListId ?? primaryList?.id ?? null,
          },
        );
        const clock = await applyTeamTagReasonsToPickClock(client, {
          orgId: desk.orgId,
          eventKey: desk.eventKey,
          result: justified,
        });

        const lastPick = lastDraftedSlot(board);

        return {
          status: "ready" as const,
          orgId: desk.orgId,
          eventKey: desk.eventKey,
          eventName: desk.eventName,
          teamNumber: desk.teamNumber,
          pickListId: board?.pickListId ?? primaryList?.id ?? null,
          pickListName: primaryList?.name ?? null,
          sources: desk.sources,
          pickMode: desk.pickMode,
          pickModeReason: desk.pickModeReason,
          scoutedTeams: desk.scoutedTeams,
          teamCount: desk.teamCount,
          epaDrifts: desk.epaDrifts.filter((row) => !excludedTeamKeys.includes(row.teamKey)),
          excludedTeamKeys,
          /** Where the next recorded pick lands, so the button can name the slot. */
          nextSlot: nextOpenBoardSlot(board),
          lastPick: lastPick
            ? {
                allianceSeed: lastPick.allianceSeed,
                pickSlot: lastPick.pickSlot,
                teamKey: lastPick.teamKey,
                teamNumber: lastPick.teamNumber,
                draftedAt: lastPick.draftedAt,
              }
            : null,
          draftedCount: board?.draftedTeamKeys.length ?? 0,
          ...clock,
        };
      },
    );

    return Response.json(payload);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load pick clock. Confirm workspace and database access.",
        orgId: null,
        eventKey: null,
      },
      { status: 200 },
    );
  }
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const orgId = trimmedOrNull(body.orgId, 64);
  const action = typeof body.action === "string" ? body.action : "";
  if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });

  const userId = session.user.id;

  try {
    const payload = await withRls({ userId, orgId }, async (client) => {
      const member = await client.query(
        `SELECT 1 FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid`,
        [orgId, userId],
      );
      if (!member.rowCount) throw new Error("forbidden");

      const eventResult = await client.query<{ eventKey: string | null }>(
        `SELECT active_event_key AS "eventKey" FROM org_active_context WHERE org_id = $1::uuid`,
        [orgId],
      );
      const eventKey = trimmedOrNull(body.eventKey, 64) ?? eventResult.rows[0]?.eventKey ?? null;
      if (!eventKey) throw new Error("Set an active event before recording a pick.");

      // Resolved inside the board module so it lands on the same list boardState() reads.
      const pickListId = trimmedOrNull(body.pickListId, 64);

      switch (action) {
        case "record-pick": {
          const teamKey =
            trimmedOrNull(body.teamKey, 16) ??
            (body.teamNumber != null ? String(body.teamNumber) : null);
          if (!teamKey) throw new Error("teamKey or teamNumber is required");
          return recordPickClockPick(client, {
            orgId,
            userId,
            eventKey,
            pickListId,
            teamKey,
            slot: slotFromBody(body),
            rationale: trimmedOrNull(body.rationale, 2000),
            force: body.force === true,
          });
        }
        case "undo-pick": {
          return undoPickClockPick(client, {
            orgId,
            userId,
            eventKey,
            pickListId,
            slot: slotFromBody(body),
          });
        }
        default:
          throw new Error(`Unknown action: ${action || "(empty)"}`);
      }
    });

    return Response.json(payload, {
      status: payload.status === "conflict" ? 409 : 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Pick clock request failed";
    if (message === "forbidden") {
      return Response.json({ error: "Organization access denied" }, { status: 403 });
    }
    return Response.json({ error: message }, { status: 400 });
  }
}
