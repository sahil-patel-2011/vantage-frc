import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  CAD_REVIEW_CHECKPOINTS,
  CAD_REVIEW_DECISIONS,
  CAD_REVIEW_PRIORITIES,
  CAD_REVIEW_STATUSES,
  addSignoff,
  computeCadReviewQueueView,
  deleteItem,
  submitItem,
  updateItemStatus,
  type CadReviewQueueView,
} from "../../../lib/cad-review-queue/compute-cad-review-queue";
import type {
  CadReviewCheckpoint,
  CadReviewDecision,
  CadReviewPriority,
  CadReviewStatus,
} from "../../../lib/cad-review-queue/types";

export type { CadReviewQueueView };

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function positiveInt(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
}

function checkpointFrom(value: unknown): CadReviewCheckpoint {
  return CAD_REVIEW_CHECKPOINTS.includes(value as CadReviewCheckpoint)
    ? (value as CadReviewCheckpoint)
    : "design_review";
}

function priorityFrom(value: unknown): CadReviewPriority {
  return CAD_REVIEW_PRIORITIES.includes(value as CadReviewPriority)
    ? (value as CadReviewPriority)
    : "normal";
}

function decisionFrom(value: unknown): CadReviewDecision | null {
  return CAD_REVIEW_DECISIONS.includes(value as CadReviewDecision) ? (value as CadReviewDecision) : null;
}

function statusFrom(value: unknown): CadReviewStatus | null {
  return CAD_REVIEW_STATUSES.includes(value as CadReviewStatus) ? (value as CadReviewStatus) : null;
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");
  const seasonParam = url.searchParams.get("seasonYear");
  const seasonYear = seasonParam ? Number(seasonParam) : null;

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeCadReviewQueueView(client, {
        userId: session.user.id,
        requestedOrg,
        seasonYear: Number.isFinite(seasonYear) ? seasonYear : null,
      }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load the CAD review queue. Select a workspace and confirm database access.",
        steps: [
          { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
        ],
        orgId: null,
        seasonYear: new Date().getUTCFullYear(),
      } satisfies CadReviewQueueView,
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
  const seasonYear = positiveInt(body.seasonYear, new Date().getUTCFullYear());

  try {
    const view = await withRls({ userId, orgId }, async (client) => {
      const member = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2`, [
        orgId,
        userId,
      ]);
      if (!member.rowCount) throw new Error("forbidden");

      switch (action) {
        case "submit-item": {
          const partName = trimmedOrNull(body.partName, 200);
          if (!partName) throw new Error("partName is required");
          await submitItem(client, {
            orgId,
            userId,
            partName,
            description: trimmedOrNull(body.description, 2000),
            checkpoint: checkpointFrom(body.checkpoint),
            cadLink: trimmedOrNull(body.cadLink, 1000),
            priority: priorityFrom(body.priority),
            requiredSignoffs: positiveInt(body.requiredSignoffs, 1),
            seasonYear,
            notes: trimmedOrNull(body.notes, 2000),
          });
          break;
        }
        case "add-signoff": {
          const itemId = trimmedOrNull(body.itemId, 64);
          if (!itemId) throw new Error("itemId is required");
          const decision = decisionFrom(body.decision);
          if (!decision) throw new Error("decision must be approved or changes_requested");
          await addSignoff(client, {
            orgId,
            userId,
            itemId,
            decision,
            comment: trimmedOrNull(body.comment, 2000),
          });
          break;
        }
        case "update-status": {
          const itemId = trimmedOrNull(body.itemId, 64);
          if (!itemId) throw new Error("itemId is required");
          const status = statusFrom(body.status);
          if (!status) throw new Error("invalid status");
          await updateItemStatus(client, { orgId, itemId, status });
          break;
        }
        case "delete-item": {
          const itemId = trimmedOrNull(body.itemId, 64);
          if (!itemId) throw new Error("itemId is required");
          await deleteItem(client, { orgId, itemId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeCadReviewQueueView(client, { userId, requestedOrg: orgId, seasonYear });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "CAD review queue request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
