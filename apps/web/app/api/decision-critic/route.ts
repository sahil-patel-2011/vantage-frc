import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  DECISION_CRITIC_CATEGORIES,
  DECISION_CRITIC_OUTCOMES,
  computeDecisionCriticView,
  currentSeasonYear,
  deleteReview,
  logReview,
  updateReviewOutcome,
  type DecisionCriticView,
} from "../../../lib/decision-critic/compute-decision-critic";
import type { DecisionCriticCategory, DecisionCriticOutcome } from "../../../lib/decision-critic/types";
import { failMeteredAi } from "../../../lib/metered-ai-fail";

export type { DecisionCriticView };

function oneOf<T extends string>(allowed: readonly T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function trimmedOrEmpty(value: unknown, max = 2000): string {
  return trimmedOrNull(value, max) ?? "";
}

function nonNegativeNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
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
      computeDecisionCriticView(client, { userId: session.user.id, requestedOrg, seasonYear }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load Decision Critic. Choose your team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
        seasonYear: seasonYear ?? currentSeasonYear(),
      } satisfies DecisionCriticView,
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
        case "log-review": {
          const subsystemName = trimmedOrNull(body.subsystemName, 200);
          const title = trimmedOrNull(body.title, 200);
          if (!subsystemName) throw new Error("subsystemName is required");
          if (!title) throw new Error("title is required");
          const category = oneOf<DecisionCriticCategory>(DECISION_CRITIC_CATEGORIES, body.category) ?? "design";
          await logReview(client, {
            orgId,
            userId,
            seasonYear,
            subsystemName,
            title,
            proposal: trimmedOrEmpty(body.proposal, 4000),
            category,
            weightAddedLbs: nonNegativeNumber(body.weightAddedLbs),
            powerAddedAmps: nonNegativeNumber(body.powerAddedAmps),
          });
          break;
        }
        case "update-outcome": {
          const reviewId = trimmedOrNull(body.reviewId, 64);
          if (!reviewId) throw new Error("reviewId is required");
          const outcome = oneOf<DecisionCriticOutcome>(DECISION_CRITIC_OUTCOMES, body.outcome);
          if (!outcome) throw new Error("outcome must be one of open, proceeded, revised, abandoned");
          await updateReviewOutcome(client, { orgId, reviewId, outcome });
          break;
        }
        case "delete-review": {
          const reviewId = trimmedOrNull(body.reviewId, 64);
          if (!reviewId) throw new Error("reviewId is required");
          await deleteReview(client, { orgId, reviewId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeDecisionCriticView(client, { userId, requestedOrg: orgId, seasonYear });
    });

    return Response.json(view);
  } catch (error) {
    return failMeteredAi(error, "Decision Critic request failed");
  }
}
