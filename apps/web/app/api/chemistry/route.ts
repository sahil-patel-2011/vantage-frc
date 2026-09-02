import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { loadAllianceChemistry } from "../../../lib/chemistry/load-chemistry";
import { promoteToPickList } from "../../../lib/picklist";
import { hydrateOrgActiveEvent } from "../../../lib/reference/hydrate-active-event";

function uuidOrNull(value: unknown): string | null {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const orgId = url.searchParams.get("orgId");
  if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });
  const teamKeys = url.searchParams.getAll("teamKey").filter(Boolean);
  const teamNumbers = url.searchParams.get("teams");
  if (teamNumbers) {
    for (const part of teamNumbers.split(/[,\s]+/).filter(Boolean)) {
      teamKeys.push(part);
    }
  }

  try {
    await hydrateOrgActiveEvent({ userId: session.user.id, requestedOrg: orgId });
    const view = await withRls({ userId: session.user.id, orgId }, async (client) =>
      loadAllianceChemistry(client, {
        orgId,
        userId: session.user.id,
        teamKeys,
      }),
    );
    return Response.json(view, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not score alliance chemistry" },
      { status: 400 },
    );
  }
}

/**
 * Writes from the chemistry surface. `promote_to_pick_list` lifts a seat onto THE pick list
 * (lib/picklist) with the chemistry read as its note, so a partner the scorer liked is on
 * the same board the desk and Pick Clock draft from.
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
  const action = typeof body.action === "string" ? body.action : "";
  if (action !== "promote_to_pick_list") {
    return Response.json({ error: "Unknown chemistry action" }, { status: 400 });
  }
  const teamKey = typeof body.teamKey === "string" || typeof body.teamKey === "number" ? body.teamKey : null;
  if (teamKey == null) return Response.json({ error: "teamKey is required" }, { status: 400 });

  try {
    const result = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const member = await client.query(
        `SELECT 1 FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid`,
        [orgId, session.user.id],
      );
      if (!member.rowCount) throw new Error("Organization access denied");
      const context = await client.query<{ eventKey: string | null }>(
        `SELECT active_event_key AS "eventKey" FROM org_active_context WHERE org_id = $1::uuid`,
        [orgId],
      );
      const eventKey = context.rows[0]?.eventKey ?? null;
      if (!eventKey) throw new Error("Set an active event before promoting to the pick list.");
      const seats = Array.isArray(body.seatTeamKeys)
        ? body.seatTeamKeys.filter((key): key is string => typeof key === "string" && key.trim().length > 0)
        : [];
      const score = typeof body.score === "number" && Number.isFinite(body.score) ? Math.round(body.score) : null;
      const rationale =
        typeof body.rationale === "string" && body.rationale.trim()
          ? body.rationale
          : `Chemistry${score != null ? ` ${score}/100` : ""}${
              seats.length ? ` with ${seats.map((key) => key.replace(/^frc/i, "")).join(" + ")}` : ""
            }`;
      return promoteToPickList(client, {
        orgId,
        userId: session.user.id,
        eventKey,
        teamKey,
        sourceKind: "chemistry",
        sourceId: seats.length ? seats.join("+") : null,
        rationale,
        tags: [],
      });
    });
    return Response.json({ promoted: result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Chemistry write failed";
    if (message === "Organization access denied") return Response.json({ error: message }, { status: 403 });
    return Response.json({ error: message }, { status: 400 });
  }
}
