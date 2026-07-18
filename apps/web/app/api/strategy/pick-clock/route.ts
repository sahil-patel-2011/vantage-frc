import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { recommendNextPick, type PickClockListHint } from "../../../../lib/strategy/pick-clock";
import {
  loadPickDesk,
  normalizeAllianceBoardState,
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

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const orgId = url.searchParams.get("orgId");
  const extraExcluded = url.searchParams.getAll("exclude").filter(Boolean);

  try {
    const payload = await withRls({ userId: session.user.id, orgId: orgId ?? undefined }, async (client) => {
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

      const boardRow = (
        await client.query<{ state: unknown }>(
          `SELECT state FROM alliance_boards
           WHERE org_id = $1 AND event_key = $2
           ORDER BY updated_at DESC
           LIMIT 1`,
          [desk.orgId, desk.eventKey],
        )
      ).rows[0];

      const board = boardRow
        ? normalizeAllianceBoardState(
            boardRow.state,
            desk.candidates.map((c) => c.teamKey),
          )
        : null;
      const draftExcluded = board ? takenFromAlliances(board.alliances) : [];
      const excludedTeamKeys = [...new Set([...draftExcluded, ...extraExcluded])];

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

      const clock = recommendNextPick({
        candidates: desk.candidates,
        excludedTeamKeys,
        pickListEntries,
        alternateCount: 2,
        pickMode: desk.pickMode,
        epaDrifts: desk.epaDrifts,
      });

      return {
        status: "ready" as const,
        orgId: desk.orgId,
        eventKey: desk.eventKey,
        eventName: desk.eventName,
        teamNumber: desk.teamNumber,
        pickListId: primaryList?.id ?? null,
        pickListName: primaryList?.name ?? null,
        sources: desk.sources,
        pickMode: desk.pickMode,
        pickModeReason: desk.pickModeReason,
        scoutedTeams: desk.scoutedTeams,
        teamCount: desk.teamCount,
        epaDrifts: desk.epaDrifts.filter((row) => !excludedTeamKeys.includes(row.teamKey)),
        excludedTeamKeys,
        ...clock,
      };
    });

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
