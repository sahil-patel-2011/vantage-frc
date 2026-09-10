import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  INCIDENT_CATEGORIES,
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  computeIncidentsView,
  createIncident,
  currentSeasonYear,
  deleteIncident,
  updateIncident,
  type IncidentsView,
} from "../../../lib/incidents/compute-incidents";
import type { IncidentCategory, IncidentSeverity, IncidentStatus } from "../../../lib/incidents/types";

export type { IncidentsView };

function oneOf<T extends string>(allowed: T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : null;
}

function isoDateOrNull(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function trimmedOrNull(value: unknown, max = 4000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function seasonFrom(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 2000 && n < 3000 ? Math.round(n) : currentSeasonYear();
}

function currentIso(): string {
  return new Date().toISOString().slice(0, 10);
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
      computeIncidentsView(client, { userId: session.user.id, requestedOrg, seasonYear }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load the incident log. Select a team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
        seasonYear: seasonYear ?? currentSeasonYear(),
      } satisfies IncidentsView,
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
        case "create-incident": {
          const title = trimmedOrNull(body.title, 200);
          if (!title) throw new Error("title is required");
          await createIncident(client, {
            orgId,
            userId,
            seasonYear,
            title,
            category: oneOf<IncidentCategory>(INCIDENT_CATEGORIES, body.category) ?? "other",
            severity: oneOf<IncidentSeverity>(INCIDENT_SEVERITIES, body.severity) ?? "moderate",
            occurredOn: isoDateOrNull(body.occurredOn) ?? currentIso(),
            location: trimmedOrNull(body.location, 200),
            description: trimmedOrNull(body.description),
            correctiveAction: trimmedOrNull(body.correctiveAction),
            owner: trimmedOrNull(body.owner, 120),
            dueOn: isoDateOrNull(body.dueOn),
          });
          break;
        }
        case "update-incident": {
          const incidentId = trimmedOrNull(body.incidentId, 64);
          if (!incidentId) throw new Error("incidentId is required");
          const category = body.category === undefined ? undefined : oneOf<IncidentCategory>(INCIDENT_CATEGORIES, body.category);
          if (body.category !== undefined && !category) throw new Error("Invalid category");
          const severity = body.severity === undefined ? undefined : oneOf<IncidentSeverity>(INCIDENT_SEVERITIES, body.severity);
          if (body.severity !== undefined && !severity) throw new Error("Invalid severity");
          const status = body.status === undefined ? undefined : oneOf<IncidentStatus>(INCIDENT_STATUSES, body.status);
          if (body.status !== undefined && !status) throw new Error("Invalid status");
          await updateIncident(client, {
            orgId,
            incidentId,
            title: body.title === undefined ? undefined : (trimmedOrNull(body.title, 200) ?? undefined),
            category: category ?? undefined,
            severity: severity ?? undefined,
            status: status ?? undefined,
            location: body.location === undefined ? undefined : trimmedOrNull(body.location, 200),
            description: body.description === undefined ? undefined : trimmedOrNull(body.description),
            correctiveAction: body.correctiveAction === undefined ? undefined : trimmedOrNull(body.correctiveAction),
            owner: body.owner === undefined ? undefined : trimmedOrNull(body.owner, 120),
            dueOn: body.dueOn === undefined ? undefined : isoDateOrNull(body.dueOn),
            occurredOn: body.occurredOn === undefined ? undefined : (isoDateOrNull(body.occurredOn) ?? undefined),
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

      return computeIncidentsView(client, { userId, requestedOrg: orgId, seasonYear });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Incident log request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
