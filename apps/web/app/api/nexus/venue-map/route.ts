// Nexus venue geometry for the Pit Map Planner.
//
// Reads the SHARED per-event cache (nexus_event_snapshots) rather than opening a
// per-request poll against the rate-limited Nexus API — the ingest worker is the
// only thing that talks to frc.nexus. Every state is honest: no active event,
// no cached payload, or no geometry each come back as their own status so the
// planner can fall back to the team's own pit-footprint layout instead of
// drawing a venue that does not exist.

import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { nexusAttributionHref, parseNexusEvent, parseNexusMap } from "@vantage/reference";
import { headers } from "next/headers";
import { buildVenueMap, type NexusVenueMapView } from "../../../../lib/display";

export type { NexusVenueMapView };

function setupRequired(message: string): NexusVenueMapView {
  return { status: "setup_required", message, attributionHref: nexusAttributionHref() };
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = new URL(request.url).searchParams.get("orgId");
  if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });

  try {
    const view = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const member = await client.query(
        `SELECT 1 FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid`,
        [orgId, session.user.id],
      );
      if (!member.rowCount) throw new Error("forbidden");

      const context = await client.query<{
        teamNumber: number | null;
        eventKey: string | null;
        eventName: string | null;
      }>(
        `SELECT o.team_number AS "teamNumber",
                c.active_event_key AS "eventKey",
                e.name AS "eventName"
         FROM organizations o
         LEFT JOIN org_active_context c ON c.org_id = o.id
         LEFT JOIN events_ref e ON e.event_key = c.active_event_key
         WHERE o.id = $1::uuid`,
        [orgId],
      );
      const row = context.rows[0];
      const eventKey = row?.eventKey ?? null;
      if (!eventKey) {
        return setupRequired(
          "Set an active event to see the venue pit map. Nothing is drawn without one.",
        );
      }

      const cached = await client.query<{ pits: unknown; live: unknown; map: unknown; syncedAt: string | null }>(
        `SELECT pits, live, map, synced_at::text AS "syncedAt"
         FROM nexus_event_snapshots WHERE event_key = $1`,
        [eventKey],
      );
      const snapshot = cached.rows[0];
      if (!snapshot) {
        return setupRequired(
          `No Nexus payload is cached for ${eventKey} yet. Nexus data appears once the event-day sync runs with a Nexus API key configured.`,
        );
      }

      const geometry = snapshot.map ? parseNexusMap(snapshot.map) : null;
      const event = snapshot.live ? parseNexusEvent(snapshot.live, eventKey, snapshot.syncedAt ?? "") : null;
      const partsRequests = event?.partsRequests ?? [];
      const map = buildVenueMap({
        map: geometry,
        teamNumber: row?.teamNumber ?? null,
        requesterTeams: partsRequests.map((entry) => entry.requestedByTeam),
      });
      if (!map) {
        return setupRequired(
          `Nexus has not published venue geometry for ${eventKey}. Your own pit layout below is unaffected.`,
        );
      }

      const pits =
        snapshot.pits && typeof snapshot.pits === "object" && !Array.isArray(snapshot.pits)
          ? (snapshot.pits as Record<string, string>)
          : {};

      return {
        status: "live" as const,
        eventKey,
        eventName: row?.eventName ?? null,
        map,
        ourPitAddress: row?.teamNumber != null ? (pits[String(row.teamNumber)] ?? null) : null,
        requests: partsRequests.map((entry) => ({
          team: entry.requestedByTeam,
          parts: entry.parts,
          pitAddress:
            entry.pitAddress ?? (entry.requestedByTeam ? (pits[entry.requestedByTeam] ?? null) : null),
        })),
        syncedAt: snapshot.syncedAt,
        attributionHref: nexusAttributionHref(),
      };
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Venue map unavailable";
    if (message === "forbidden") {
      return Response.json({ error: "Organization access denied" }, { status: 403 });
    }
    return Response.json(
      setupRequired("Could not read the Nexus venue map. Your own pit layout below is unaffected."),
      { status: 200 },
    );
  }
}
