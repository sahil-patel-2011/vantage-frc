import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { CHECKLIST_ITEM_KEYS } from "../../../lib/match-checklist";
import {
  computeMatchChecklistView,
  deleteChecklistRun,
  startChecklistRun,
  toggleChecklistItem,
  type MatchChecklistView,
} from "../../../lib/match-checklist/compute-match-checklist";
import type { ChecklistItemKey } from "../../../lib/match-checklist/types";

export type { MatchChecklistView };

function trimmedOrNull(value: unknown, max = 200): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function intOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function oneOfItemKey(value: unknown): ChecklistItemKey | null {
  return typeof value === "string" && (CHECKLIST_ITEM_KEYS as string[]).includes(value)
    ? (value as ChecklistItemKey)
    : null;
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeMatchChecklistView(client, { userId: session.user.id, requestedOrg }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load the pre-match checklist. Select a workspace and confirm database access.",
        steps: [
          { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
        ],
        orgId: null,
      } satisfies MatchChecklistView,
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
        case "start-run": {
          const matchLabel = trimmedOrNull(body.matchLabel, 100);
          if (!matchLabel) throw new Error("matchLabel is required");
          await startChecklistRun(client, {
            orgId,
            userId,
            matchLabel,
            eventKey: trimmedOrNull(body.eventKey, 100),
            teamNumber: intOrNull(body.teamNumber),
          });
          break;
        }
        case "toggle-item": {
          const runId = trimmedOrNull(body.runId, 64);
          const itemKey = oneOfItemKey(body.itemKey);
          if (!runId) throw new Error("runId is required");
          if (!itemKey) throw new Error("itemKey is invalid");
          await toggleChecklistItem(client, { orgId, runId, itemKey });
          break;
        }
        case "delete-run": {
          const runId = trimmedOrNull(body.runId, 64);
          if (!runId) throw new Error("runId is required");
          await deleteChecklistRun(client, { orgId, runId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeMatchChecklistView(client, { userId, requestedOrg: orgId });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Match checklist request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
