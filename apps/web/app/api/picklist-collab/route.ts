import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { PICKLIST_COLLAB_TIERS, clampWeight } from "../../../lib/picklist-collab";
import {
  addEntry,
  castVote,
  computePicklistCollabView,
  createList,
  currentSeasonYear,
  deleteEntry,
  moveEntry,
  removeVote,
  updateListStatus,
  type PicklistCollabView,
} from "../../../lib/picklist-collab/compute-picklist-collab";
import type { PicklistCollabListStatus, PicklistCollabTier } from "../../../lib/picklist-collab/types";

export type { PicklistCollabView };

const LIST_STATUSES: PicklistCollabListStatus[] = ["open", "locked", "archived"];

function oneOf<T extends string>(allowed: T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : null;
}

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function positiveInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
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
  const listId = url.searchParams.get("listId");

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computePicklistCollabView(client, { userId: session.user.id, requestedOrg, listId }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load the pick list. Select a workspace and confirm database access.",
        steps: [
          { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
        ],
        orgId: null,
      } satisfies PicklistCollabView,
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
  const listId = trimmedOrNull(body.listId, 64);

  try {
    const view = await withRls({ userId, orgId }, async (client) => {
      const member = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2`, [
        orgId,
        userId,
      ]);
      if (!member.rowCount) throw new Error("forbidden");

      switch (action) {
        case "create-list": {
          const name = trimmedOrNull(body.name, 200);
          const eventKey = trimmedOrNull(body.eventKey, 64);
          if (!name) throw new Error("name is required");
          if (!eventKey) throw new Error("eventKey is required");
          await createList(client, {
            orgId,
            userId,
            eventKey,
            name,
            seasonYear: seasonFrom(body.seasonYear),
          });
          break;
        }
        case "update-list-status": {
          if (!listId) throw new Error("listId is required");
          const status = oneOf<PicklistCollabListStatus>(LIST_STATUSES, body.status);
          if (!status) throw new Error("status is required");
          await updateListStatus(client, { orgId, listId, status });
          break;
        }
        case "add-entry": {
          if (!listId) throw new Error("listId is required");
          const teamNumber = positiveInt(body.teamNumber);
          if (!teamNumber) throw new Error("teamNumber is required");
          const tier = oneOf<PicklistCollabTier>(PICKLIST_COLLAB_TIERS, body.tier) ?? "unranked";
          await addEntry(client, {
            orgId,
            userId,
            listId,
            teamNumber,
            teamName: trimmedOrNull(body.teamName, 120),
            tier,
            note: trimmedOrNull(body.note, 2000),
          });
          break;
        }
        case "move-entry": {
          const entryId = trimmedOrNull(body.entryId, 64);
          if (!entryId) throw new Error("entryId is required");
          const tier = oneOf<PicklistCollabTier>(PICKLIST_COLLAB_TIERS, body.tier);
          if (!tier) throw new Error("tier is required");
          const position = positiveInt(body.position) ?? 0;
          await moveEntry(client, { orgId, entryId, tier, position });
          break;
        }
        case "delete-entry": {
          const entryId = trimmedOrNull(body.entryId, 64);
          if (!entryId) throw new Error("entryId is required");
          await deleteEntry(client, { orgId, entryId });
          break;
        }
        case "cast-vote": {
          const entryId = trimmedOrNull(body.entryId, 64);
          if (!entryId) throw new Error("entryId is required");
          const weight = clampWeight(Number(body.weight) || 1);
          const rankSuggestion = positiveInt(body.rankSuggestion);
          await castVote(client, {
            orgId,
            userId,
            entryId,
            weight,
            rankSuggestion,
            comment: trimmedOrNull(body.comment, 1000),
          });
          break;
        }
        case "remove-vote": {
          const entryId = trimmedOrNull(body.entryId, 64);
          if (!entryId) throw new Error("entryId is required");
          await removeVote(client, { orgId, userId, entryId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computePicklistCollabView(client, { userId, requestedOrg: orgId, listId });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Pick list request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
