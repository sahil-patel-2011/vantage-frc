import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  DEFAULT_UPSET_THRESHOLD,
  acknowledgeAlert,
  computeMatchDeltaWatcherView,
  scanEventForDeltas,
  upsertConfig,
  type MatchDeltaWatcherView,
} from "../../../lib/match-delta-watcher/compute-match-delta-watcher";

export type { MatchDeltaWatcherView };

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function thresholdFrom(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0.5 && n <= 1 ? n : DEFAULT_UPSET_THRESHOLD;
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");
  const requestedEvent = url.searchParams.get("eventKey");

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeMatchDeltaWatcherView(client, { userId: session.user.id, requestedOrg, requestedEvent }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load the match-delta watcher. Select a workspace and confirm database access.",
        steps: [
          { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
        ],
        orgId: null,
        eventKey: null,
      } satisfies MatchDeltaWatcherView,
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
    const view = await withRls({ userId, orgId }, async (client) => {
      const member = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2`, [
        orgId,
        userId,
      ]);
      if (!member.rowCount) throw new Error("forbidden");

      const eventKey = trimmedOrNull(body.eventKey, 100);

      switch (action) {
        case "scan-event": {
          if (!eventKey) throw new Error("eventKey is required");
          const upsetThreshold = thresholdFrom(body.upsetThreshold);
          await scanEventForDeltas(client, { orgId, userId, eventKey, upsetThreshold });
          break;
        }
        case "set-config": {
          if (!eventKey) throw new Error("eventKey is required");
          await upsertConfig(client, {
            orgId,
            userId,
            eventKey,
            enabled: body.enabled !== false,
            upsetThreshold: thresholdFrom(body.upsetThreshold),
          });
          break;
        }
        case "acknowledge-alert": {
          const alertId = trimmedOrNull(body.alertId, 64);
          if (!alertId) throw new Error("alertId is required");
          await acknowledgeAlert(client, { orgId, userId, alertId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeMatchDeltaWatcherView(client, { userId, requestedOrg: orgId, requestedEvent: eventKey });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Match-delta watcher request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
