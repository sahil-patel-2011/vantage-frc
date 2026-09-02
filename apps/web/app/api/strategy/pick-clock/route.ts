import type { PoolClient } from "@neondatabase/serverless";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  boardState,
  DRAFT_PICK_SLOTS,
  ensurePickList,
  setBoardSlot,
  type DraftPickSlot,
} from "../../../../lib/picklist";
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

const SETUP_FALLBACK = {
  status: "setup_required" as const,
  message: "Could not load pick clock. Confirm workspace and database access.",
  orgId: null,
  eventKey: null,
};

/**
 * ONE payload builder for GET and POST so a recorded pick refreshes the clock with exactly
 * the exclusions the next read would see: the legacy alliance_boards state, the spine's
 * drafted_* slots (lib/picklist), and whatever the caller excluded by hand.
 */
async function buildPickClockPayload(
  client: PoolClient,
  input: { userId: string; orgId: string | null; extraExcluded: string[] },
) {
  const desk = await loadPickDesk(client, {
    userId: input.userId,
    requestedOrg: input.orgId,
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
  const legacyExcluded = board ? takenFromAlliances(board.alliances) : [];

  // The spine's draft board is the truth about who is already picked.
  let spineExcluded: string[];
  try {
    const spine = await boardState(client, { orgId: desk.orgId, eventKey: desk.eventKey });
    spineExcluded = spine?.draftedTeamKeys ?? [];
  } catch {
    spineExcluded = [];
  }
  const excludedTeamKeys = [...new Set([...legacyExcluded, ...spineExcluded, ...input.extraExcluded])];

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
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const orgId = url.searchParams.get("orgId");
  const extraExcluded = url.searchParams.getAll("exclude").filter(Boolean);

  try {
    const payload = await withRls({ userId: session.user.id, orgId: orgId ?? undefined }, (client) =>
      buildPickClockPayload(client, { userId: session.user.id, orgId, extraExcluded }),
    );
    return Response.json(payload);
  } catch {
    return Response.json(SETUP_FALLBACK, { status: 200 });
  }
}

function uuidOrNull(value: unknown): string | null {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

/**
 * Record a pick made on the clock: stamps `drafted_alliance_seed` / `drafted_pick_slot` on THE
 * pick list (lib/picklist setBoardSlot — the same rows the alliance desk drafts on) and returns
 * the refreshed clock with that team excluded. `exclude` carries the caller's hand-skipped
 * teams so they stay out across the refresh.
 */
export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const orgId = uuidOrNull(body.orgId);
  if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });
  const action = typeof body.action === "string" ? body.action : "record_pick";
  if (action !== "record_pick") return Response.json({ error: "Unknown pick clock action" }, { status: 400 });
  const teamKey = typeof body.teamKey === "string" ? body.teamKey.trim() : "";
  const allianceSeed = Number(body.allianceSeed);
  const pickSlot = typeof body.pickSlot === "string" ? (body.pickSlot as DraftPickSlot) : "first";
  const extraExcluded = Array.isArray(body.exclude)
    ? body.exclude.filter((key): key is string => typeof key === "string" && key.trim().length > 0)
    : [];
  if (!teamKey) return Response.json({ error: "teamKey is required" }, { status: 400 });
  if (!Number.isInteger(allianceSeed) || allianceSeed < 1 || allianceSeed > 8) {
    return Response.json({ error: "allianceSeed must be 1-8" }, { status: 400 });
  }
  if (!DRAFT_PICK_SLOTS.includes(pickSlot)) {
    return Response.json({ error: "pickSlot must be captain, first or second" }, { status: 400 });
  }

  try {
    const payload = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const desk = await loadPickDesk(client, { userId: session.user.id, requestedOrg: orgId });
      if ("status" in desk) throw new Error(desk.message);
      const pickListId =
        desk.pickLists[0]?.id ??
        (await ensurePickList(client, {
          orgId: desk.orgId,
          userId: session.user.id,
          eventKey: desk.eventKey,
          source: "strategy",
        }));
      await setBoardSlot(client, {
        orgId: desk.orgId,
        userId: session.user.id,
        pickListId,
        allianceSeed,
        pickSlot,
        teamKey,
        rationale: typeof body.rationale === "string" && body.rationale.trim() ? body.rationale.trim().slice(0, 400) : null,
      });
      const refreshed = await buildPickClockPayload(client, {
        userId: session.user.id,
        orgId,
        extraExcluded,
      });
      return { ...refreshed, recorded: { teamKey, allianceSeed, pickSlot, pickListId } };
    });
    return Response.json(payload);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not record the pick" },
      { status: 400 },
    );
  }
}
