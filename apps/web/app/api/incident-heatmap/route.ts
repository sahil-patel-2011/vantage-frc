import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  INCIDENT_CONTEXTS,
  computeIncidentHeatmapView,
  currentSeasonYear,
  deleteIncident,
  logIncident,
  type IncidentHeatmapView,
} from "../../../lib/incident-heatmap/compute-incident-heatmap";
import type { IncidentContext } from "../../../lib/incident-heatmap/types";

export type { IncidentHeatmapView };

function oneOf<T extends string>(allowed: T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : null;
}

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function isoTimestampOrNow(value: unknown): string {
  if (typeof value === "string" && !Number.isNaN(new Date(value).getTime())) return value;
  return new Date().toISOString();
}

function seasonFrom(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 2000 && n < 3000 ? Math.round(n) : currentSeasonYear();
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");
  const seasonParam = url.searchParams.get("season");
  const seasonYear = seasonParam ? seasonFrom(seasonParam) : null;

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeIncidentHeatmapView(client, { userId: session.user.id, requestedOrg, seasonYear }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load the Incident Heatmap. Select a team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
        seasonYear: seasonYear ?? currentSeasonYear(),
      } satisfies IncidentHeatmapView,
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
  const seasonYear = seasonFrom(body.seasonYear);

  try {
    const view = await withRls({ userId, orgId }, async (client) => {
      const member = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2`, [
        orgId,
        userId,
      ]);
      if (!member.rowCount) throw new Error("forbidden");

      switch (action) {
        case "log-incident": {
          const subsystem = trimmedOrNull(body.subsystem, 100);
          const title = trimmedOrNull(body.title, 200);
          if (!subsystem) throw new Error("subsystem is required");
          if (!title) throw new Error("title is required");
          const context = oneOf<IncidentContext>(INCIDENT_CONTEXTS, body.context) ?? "pit";
          await logIncident(client, {
            orgId,
            userId,
            subsystem,
            context,
            eventKey: trimmedOrNull(body.eventKey, 40),
            matchKey: trimmedOrNull(body.matchKey, 60),
            title,
            notes: trimmedOrNull(body.notes, 4000),
            occurredAt: isoTimestampOrNow(body.occurredAt),
            seasonYear,
          });
          break;
        }
        case "delete-incident": {
          const incidentId = trimmedOrNull(body.incidentId, 64);
          if (!incidentId) throw new Error("incidentId is required");
          await deleteIncident(client, { orgId, incidentId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeIncidentHeatmapView(client, { userId, requestedOrg: orgId, seasonYear });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Incident Heatmap request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
