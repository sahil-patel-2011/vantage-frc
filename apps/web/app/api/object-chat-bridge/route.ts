import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  OBJECT_CHAT_BRIDGE_OBJECT_TYPES,
  OBJECT_CHAT_BRIDGE_STATUSES,
  OBJECT_CHAT_BRIDGE_SUBTEAMS,
} from "../../../lib/object-chat-bridge";
import {
  acknowledgeNotification,
  computeObjectChatBridgeView,
  createLink,
  currentSeasonYear,
  deleteLink,
  notifySubteam,
  updateLinkStatus,
  type ObjectChatBridgeView,
} from "../../../lib/object-chat-bridge/compute-object-chat-bridge";
import type {
  ObjectChatBridgeLinkStatus,
  ObjectChatBridgeObjectType,
  ObjectChatBridgeSubteam,
} from "../../../lib/object-chat-bridge/types";

export type { ObjectChatBridgeView };

function oneOf<T extends string>(allowed: T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : null;
}

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
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
      computeObjectChatBridgeView(client, { userId: session.user.id, requestedOrg, seasonYear }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load the subteam comm bridge. Choose your team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
        seasonYear: seasonYear ?? currentSeasonYear(),
      } satisfies ObjectChatBridgeView,
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
        case "create-link": {
          const objectRef = trimmedOrNull(body.objectRef, 200);
          const threadRef = trimmedOrNull(body.threadRef, 200);
          if (!objectRef) throw new Error("objectRef is required");
          if (!threadRef) throw new Error("threadRef is required");
          const objectType =
            oneOf<ObjectChatBridgeObjectType>(OBJECT_CHAT_BRIDGE_OBJECT_TYPES, body.objectType) ?? "subsystem";
          const subteam = oneOf<ObjectChatBridgeSubteam>(OBJECT_CHAT_BRIDGE_SUBTEAMS, body.subteam) ?? "other";
          await createLink(client, {
            orgId,
            userId,
            objectType,
            objectRef,
            objectLabel: trimmedOrNull(body.objectLabel, 200),
            threadRef,
            subteam,
            context: trimmedOrNull(body.context, 4000),
            seasonYear,
          });
          break;
        }
        case "update-status": {
          const linkId = trimmedOrNull(body.linkId, 64);
          if (!linkId) throw new Error("linkId is required");
          const status = oneOf<ObjectChatBridgeLinkStatus>(OBJECT_CHAT_BRIDGE_STATUSES, body.status);
          if (!status) throw new Error("status is required");
          await updateLinkStatus(client, { orgId, linkId, status });
          break;
        }
        case "delete-link": {
          const linkId = trimmedOrNull(body.linkId, 64);
          if (!linkId) throw new Error("linkId is required");
          await deleteLink(client, { orgId, linkId });
          break;
        }
        case "notify-subteam": {
          const linkId = trimmedOrNull(body.linkId, 64);
          const message = trimmedOrNull(body.message, 2000);
          if (!linkId) throw new Error("linkId is required");
          if (!message) throw new Error("message is required");
          const notifiedSubteam =
            oneOf<ObjectChatBridgeSubteam>(OBJECT_CHAT_BRIDGE_SUBTEAMS, body.notifiedSubteam) ?? "other";
          await notifySubteam(client, { orgId, userId, linkId, notifiedSubteam, message });
          break;
        }
        case "acknowledge-notification": {
          const notificationId = trimmedOrNull(body.notificationId, 64);
          if (!notificationId) throw new Error("notificationId is required");
          await acknowledgeNotification(client, { orgId, userId, notificationId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeObjectChatBridgeView(client, { userId, requestedOrg: orgId, seasonYear });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Object chat bridge request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
