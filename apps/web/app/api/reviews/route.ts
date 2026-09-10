import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  ITEM_VERDICTS,
  REVIEW_STAGES,
  REVIEW_STATUSES,
  addItem,
  computeReviewsView,
  createReview,
  currentSeasonYear,
  deleteReview,
  removeItem,
  updateItem,
  updateReview,
  type ReviewsView,
} from "../../../lib/reviews/compute-reviews";
import type { ItemVerdict, ReviewStage, ReviewStatus } from "../../../lib/reviews/types";

export type { ReviewsView };

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

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");
  const seasonParam = url.searchParams.get("season");
  const seasonYear = seasonParam ? seasonFrom(seasonParam) : null;

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeReviewsView(client, { userId: session.user.id, requestedOrg, seasonYear }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load design reviews. Select a team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
        seasonYear: seasonYear ?? currentSeasonYear(),
      } satisfies ReviewsView,
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
        case "create-review": {
          const title = trimmedOrNull(body.title, 200);
          if (!title) throw new Error("title is required");
          await createReview(client, {
            orgId,
            userId,
            seasonYear,
            title,
            subsystem: trimmedOrNull(body.subsystem, 80) ?? "general",
            stage: oneOf<ReviewStage>(REVIEW_STAGES, body.stage) ?? "critical",
            scheduledOn: isoDateOrNull(body.scheduledOn),
            reviewers: trimmedOrNull(body.reviewers, 300),
            seedChecklist: body.seedChecklist !== false,
          });
          break;
        }
        case "update-review": {
          const reviewId = trimmedOrNull(body.reviewId, 64);
          if (!reviewId) throw new Error("reviewId is required");
          const stage = body.stage === undefined ? undefined : oneOf<ReviewStage>(REVIEW_STAGES, body.stage);
          if (body.stage !== undefined && !stage) throw new Error("Invalid stage");
          const status = body.status === undefined ? undefined : oneOf<ReviewStatus>(REVIEW_STATUSES, body.status);
          if (body.status !== undefined && !status) throw new Error("Invalid status");
          await updateReview(client, {
            orgId,
            reviewId,
            title: body.title === undefined ? undefined : (trimmedOrNull(body.title, 200) ?? undefined),
            subsystem: body.subsystem === undefined ? undefined : (trimmedOrNull(body.subsystem, 80) ?? undefined),
            stage: stage ?? undefined,
            status: status ?? undefined,
            scheduledOn: body.scheduledOn === undefined ? undefined : isoDateOrNull(body.scheduledOn),
            reviewers: body.reviewers === undefined ? undefined : trimmedOrNull(body.reviewers, 300),
            notes: body.notes === undefined ? undefined : trimmedOrNull(body.notes),
          });
          break;
        }
        case "delete-review": {
          const reviewId = trimmedOrNull(body.reviewId, 64);
          if (!reviewId) throw new Error("reviewId is required");
          await deleteReview(client, { orgId, reviewId });
          break;
        }
        case "add-item": {
          const reviewId = trimmedOrNull(body.reviewId, 64);
          const criterion = trimmedOrNull(body.criterion, 300);
          if (!reviewId) throw new Error("reviewId is required");
          if (!criterion) throw new Error("criterion is required");
          await addItem(client, { orgId, reviewId, criterion, blocking: body.blocking === true });
          break;
        }
        case "update-item": {
          const reviewId = trimmedOrNull(body.reviewId, 64);
          const itemId = trimmedOrNull(body.itemId, 64);
          if (!reviewId || !itemId) throw new Error("reviewId and itemId are required");
          const verdict = body.verdict === undefined ? undefined : oneOf<ItemVerdict>(ITEM_VERDICTS, body.verdict);
          if (body.verdict !== undefined && !verdict) throw new Error("Invalid verdict");
          await updateItem(client, {
            orgId,
            reviewId,
            itemId,
            verdict: verdict ?? undefined,
            blocking: body.blocking === undefined ? undefined : body.blocking === true,
          });
          break;
        }
        case "remove-item": {
          const reviewId = trimmedOrNull(body.reviewId, 64);
          const itemId = trimmedOrNull(body.itemId, 64);
          if (!reviewId || !itemId) throw new Error("reviewId and itemId are required");
          await removeItem(client, { orgId, reviewId, itemId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeReviewsView(client, { userId, requestedOrg: orgId, seasonYear });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Design reviews request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
