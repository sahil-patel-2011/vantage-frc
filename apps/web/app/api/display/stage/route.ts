// Phase-aware pit display feed.
//
// Same two access paths as /api/display/snapshot: a read-only TV token (the
// SECURITY DEFINER get_display_stage) or a signed-in orgId+boardId preview.
// The Nexus payload cached for the event is parsed HERE, on the server, so the
// TV never has to interpret a Nexus body — and so a payload Nexus never posted
// arrives as null rather than as an empty-looking screen full of dashes.

import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { getDisplayPool } from "@vantage/db/display";
import { parseNexusEvent, parseNexusMap } from "@vantage/reference";
import { headers } from "next/headers";
import { buildNexusQueueSnapshot } from "../../../../lib/command/nexus-queue";
import {
  DISPLAY_STAGE_SELECT,
  buildVenueMap,
  type DisplayStagePayload,
  type DisplayStageSnapshot,
} from "../../../../lib/display";

function asPits(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [team, address] of Object.entries(value as Record<string, unknown>)) {
    if (typeof address === "string" && address.trim()) out[team] = address;
  }
  return out;
}

/** Attach the queue view and the venue map derived from the cached Nexus body. */
function withNexusViews(snapshot: DisplayStageSnapshot): DisplayStagePayload {
  const nexus = snapshot.nexus;
  const eventKey = snapshot.activeEvent?.eventKey ?? null;
  if (!nexus || !eventKey) return { ...snapshot, queue: null, venueMap: null };

  const pits = asPits(nexus.pits);
  const teamNumber = snapshot.organization?.teamNumber ?? null;

  const event = nexus.live
    ? parseNexusEvent(nexus.live, eventKey, nexus.syncedAt ?? snapshot.updatedAt)
    : null;
  const queue = event ? buildNexusQueueSnapshot({ event, pits, teamNumber }) : null;

  const venueMap = nexus.map
    ? buildVenueMap({
        map: parseNexusMap(nexus.map),
        teamNumber,
        // Only teams that actually posted a parts request get highlighted.
        requesterTeams: (event?.partsRequests ?? []).map((request) => request.requestedByTeam),
      })
    : null;

  return { ...snapshot, queue, venueMap };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const token = url.searchParams.get("token");
    if (token) {
      const result = await getDisplayPool().query<{ stage: DisplayStageSnapshot | null }>(
        "SELECT get_display_stage($1) AS stage",
        [token],
      );
      const stage = result.rows[0]?.stage;
      if (!stage) {
        return Response.json({ error: "Display token is invalid or expired" }, { status: 401 });
      }
      return Response.json(withNexusViews(stage));
    }

    const session = await auth.api.getSession({ headers: await headers() });
    const orgId = url.searchParams.get("orgId");
    const boardId = url.searchParams.get("boardId");
    if (!session || !orgId || !boardId) {
      return Response.json(
        { error: "Authentication, orgId, and boardId are required" },
        { status: 401 },
      );
    }

    const stage = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const result = await client.query<{ stage: DisplayStageSnapshot | null }>(
        `${DISPLAY_STAGE_SELECT} WHERE b.id = $1 AND b.org_id = $2`,
        [boardId, orgId],
      );
      return result.rows[0]?.stage ?? null;
    });

    if (!stage) {
      return Response.json({ error: "Display board not found" }, { status: 404 });
    }
    return Response.json(withNexusViews(stage));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Display unavailable" },
      { status: 400 },
    );
  }
}
