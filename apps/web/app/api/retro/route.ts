import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  addActionItem,
  addItem,
  closeSession,
  computeRetroView,
  createSession,
  currentSeasonYear,
  deleteActionItem,
  deleteItem,
  generatePostmortem,
  toggleVote,
  updateActionStatus,
  type RetroView,
} from "../../../lib/retro/compute-retro";
import { handoffLearnedItems } from "../../../lib/retro/handoff";
import { RETRO_ITEM_KINDS } from "../../../lib/retro";
import type { RetroActionStatus, RetroItemKind } from "../../../lib/retro/types";

export type { RetroView };

const RETRO_ACTION_STATUSES: RetroActionStatus[] = ["open", "in_progress", "done"];

function oneOf<T extends string>(allowed: T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : null;
}

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function isoDateOrNull(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
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
  const sessionId = trimmedOrNull(url.searchParams.get("sessionId"), 64);

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeRetroView(client, { userId: session.user.id, requestedOrg, seasonYear, sessionId }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load the retrospective. Select a team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
        seasonYear: seasonYear ?? currentSeasonYear(),
      } satisfies RetroView,
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
  const sessionId = trimmedOrNull(body.sessionId, 64);

  try {
    const view = await withRls({ userId, orgId }, async (client) => {
      const member = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2`, [
        orgId,
        userId,
      ]);
      if (!member.rowCount) throw new Error("forbidden");

      switch (action) {
        case "create-session": {
          const title = trimmedOrNull(body.title, 200);
          if (!title) throw new Error("title is required");
          const periodLabel = trimmedOrNull(body.periodLabel, 120) ?? "";
          await createSession(client, { orgId, userId, seasonYear, title, periodLabel });
          break;
        }
        case "close-session": {
          if (!sessionId) throw new Error("sessionId is required");
          await closeSession(client, { orgId, sessionId });
          break;
        }
        case "add-item": {
          if (!sessionId) throw new Error("sessionId is required");
          const kind = oneOf<RetroItemKind>(RETRO_ITEM_KINDS, body.kind);
          const content = trimmedOrNull(body.content, 2000);
          if (!kind) throw new Error("kind must be start, stop, or continue");
          if (!content) throw new Error("content is required");
          await addItem(client, { orgId, userId, sessionId, kind, content });
          break;
        }
        case "delete-item": {
          const itemId = trimmedOrNull(body.itemId, 64);
          if (!itemId) throw new Error("itemId is required");
          await deleteItem(client, { orgId, itemId });
          break;
        }
        case "toggle-vote": {
          const itemId = trimmedOrNull(body.itemId, 64);
          if (!itemId) throw new Error("itemId is required");
          await toggleVote(client, { orgId, userId, itemId });
          break;
        }
        case "add-action": {
          if (!sessionId) throw new Error("sessionId is required");
          const title = trimmedOrNull(body.title, 200);
          if (!title) throw new Error("title is required");
          await addActionItem(client, {
            orgId,
            userId,
            sessionId,
            title,
            owner: trimmedOrNull(body.owner, 120),
            dueOn: isoDateOrNull(body.dueOn),
          });
          break;
        }
        case "update-action-status": {
          const actionId = trimmedOrNull(body.actionId, 64);
          const status = oneOf<RetroActionStatus>(RETRO_ACTION_STATUSES, body.status);
          if (!actionId) throw new Error("actionId is required");
          if (!status) throw new Error("status must be open, in_progress, or done");
          await updateActionStatus(client, { orgId, actionId, status });
          break;
        }
        case "delete-action": {
          const actionId = trimmedOrNull(body.actionId, 64);
          if (!actionId) throw new Error("actionId is required");
          await deleteActionItem(client, { orgId, actionId });
          break;
        }
        case "generate-postmortem": {
          await generatePostmortem(client, { orgId, userId, seasonYear });
          break;
        }
        case "handoff-lessons": {
          const itemIds = Array.isArray(body.itemIds)
            ? body.itemIds.filter((id): id is string => typeof id === "string")
            : null;
          const lastHandoff = await handoffLearnedItems(client, {
            orgId,
            userId,
            seasonYear,
            target: body.target,
            itemIds,
          });
          const view = await computeRetroView(client, {
            userId,
            requestedOrg: orgId,
            seasonYear,
            sessionId,
          });
          if (view.status === "live") return { ...view, lastHandoff };
          return view;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeRetroView(client, { userId, requestedOrg: orgId, seasonYear, sessionId });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Retro request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
