import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { SUBSYSTEM_EVENT_DOMAINS } from "../../../lib/cross-domain-alerts";
import {
  acknowledgeAlert,
  computeCrossDomainAlertsView,
  currentSeasonYear,
  deleteSubsystemEvent,
  logSubsystemEvent,
  type CrossDomainAlertsView,
} from "../../../lib/cross-domain-alerts/compute-cross-domain-alerts";
import type { SubsystemEventDomain } from "../../../lib/cross-domain-alerts/types";

export type { CrossDomainAlertsView };

function oneOf<T extends string>(allowed: T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : null;
}

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function isoTimestampOrNull(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
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
      computeCrossDomainAlertsView(client, { userId: session.user.id, requestedOrg, seasonYear }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load cross-domain alerts. Choose your team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
        seasonYear: seasonYear ?? currentSeasonYear(),
      } satisfies CrossDomainAlertsView,
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
        case "log-event": {
          const subsystem = trimmedOrNull(body.subsystem, 120);
          const title = trimmedOrNull(body.title, 200);
          if (!subsystem) throw new Error("subsystem is required");
          if (!title) throw new Error("title is required");
          const domain = oneOf<SubsystemEventDomain>(SUBSYSTEM_EVENT_DOMAINS, body.domain) ?? "cad";
          await logSubsystemEvent(client, {
            orgId,
            userId,
            subsystem,
            domain,
            title,
            description: trimmedOrNull(body.description, 4000),
            occurredAt: isoTimestampOrNull(body.occurredAt),
            seasonYear,
          });
          break;
        }
        case "delete-event": {
          const eventId = trimmedOrNull(body.eventId, 64);
          if (!eventId) throw new Error("eventId is required");
          await deleteSubsystemEvent(client, { orgId, eventId });
          break;
        }
        case "acknowledge-alert": {
          const alertKey = trimmedOrNull(body.alertKey, 300);
          if (!alertKey) throw new Error("alertKey is required");
          await acknowledgeAlert(client, {
            orgId,
            userId,
            seasonYear,
            alertKey,
            note: trimmedOrNull(body.note, 1000),
          });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeCrossDomainAlertsView(client, { userId, requestedOrg: orgId, seasonYear });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cross-domain alerts request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
