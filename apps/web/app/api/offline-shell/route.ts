import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { OFFLINE_SHELL_NETWORK_STATUSES } from "../../../lib/offline-shell";
import {
  computeOfflineShellView,
  deleteCacheEvent,
  logCacheEvent,
  type OfflineShellView,
} from "../../../lib/offline-shell/compute-offline-shell";
import type { OfflineShellNetworkStatus } from "../../../lib/offline-shell/types";

export type { OfflineShellView };

function oneOf<T extends string>(allowed: T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : null;
}

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function nonNegativeInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

function routesFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((route): route is string => typeof route === "string" && route.startsWith("/"))
    .map((route) => route.slice(0, 200))
    .slice(0, 50);
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeOfflineShellView(client, { userId: session.user.id, requestedOrg }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load Offline Shell status. Select a workspace and confirm database access.",
        steps: [
          { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
        ],
        orgId: null,
      } satisfies OfflineShellView,
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

      switch (action) {
        case "log-cache-event": {
          const deviceLabel = trimmedOrNull(body.deviceLabel, 120);
          if (!deviceLabel) throw new Error("deviceLabel is required");
          const routes = routesFrom(body.routes);
          const networkStatus =
            oneOf<OfflineShellNetworkStatus>(OFFLINE_SHELL_NETWORK_STATUSES, body.networkStatus) ?? "online";
          await logCacheEvent(client, {
            orgId,
            userId,
            deviceLabel,
            routes,
            cacheBytes: nonNegativeInt(body.cacheBytes),
            networkStatus,
            notes: trimmedOrNull(body.notes, 2000),
          });
          break;
        }
        case "delete-cache-event": {
          const eventId = trimmedOrNull(body.eventId, 64);
          if (!eventId) throw new Error("eventId is required");
          await deleteCacheEvent(client, { orgId, eventId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeOfflineShellView(client, { userId, requestedOrg: orgId });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Offline Shell request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
