import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { loadAllianceChemistry } from "../../../lib/chemistry/load-chemistry";
import {
  isChemistryPromoteAction,
  partnerFitFromView,
  promoteChemistryShortlist,
} from "../../../lib/chemistry/promote-to-pick-list";
import { hydrateOrgActiveEvent } from "../../../lib/reference/hydrate-active-event";

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
 * Save chemistry candidates onto the ONE pick list.
 *
 * Chemistry used to be a dead end: it scored an alliance and suggested third seats, and the only
 * way to act on it was retyping team numbers into Strategy. This writes the same
 * pick_lists / pick_list_entries rows the pick desk, Pick Clock and draft board read, under the
 * caller's RLS session, and re-returns the chemistry view so the page stays in one round trip.
 */
export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: {
    orgId?: string;
    action?: string;
    teamKeys?: Array<string | number>;
    bucket?: string;
    notes?: string;
    selection?: Array<string | number>;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const orgId = body.orgId;
  if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });
  if (body.action && !isChemistryPromoteAction(body.action)) {
    return Response.json({ error: `Unknown action: ${body.action}` }, { status: 400 });
  }
  const requested = Array.isArray(body.teamKeys) ? body.teamKeys : [];
  if (!requested.length) {
    return Response.json({ error: "Select at least one team to save." }, { status: 400 });
  }

  try {
    await hydrateOrgActiveEvent({ userId: session.user.id, requestedOrg: orgId });
    const result = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const view = await loadAllianceChemistry(client, {
        orgId,
        userId: session.user.id,
        teamKeys: Array.isArray(body.selection)
          ? body.selection.map((value) => String(value))
          : undefined,
      });
      if (!view.eventKey) {
        throw new Error(
          "Select an active event on Event Day Command before saving to the pick list.",
        );
      }
      // Fit comes from the just-loaded view — never from a client-supplied DEMO score.
      const promotion = await promoteChemistryShortlist(client, {
        orgId,
        userId: session.user.id,
        eventKey: view.eventKey,
        teamKeys: requested,
        bucket: body.bucket,
        notes: body.notes ?? null,
        fit: partnerFitFromView(view),
      });
      return { ...view, promotion };
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not save to the pick list" },
      { status: 400 },
    );
  }
}
