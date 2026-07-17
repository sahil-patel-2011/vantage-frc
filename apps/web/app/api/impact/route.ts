import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  IMPACT_AUDIENCES,
  IMPACT_AWARD_TAGS,
  IMPACT_CATEGORIES,
  computeImpactView,
  currentSeasonYear,
  deleteActivity,
  logActivity,
  type ImpactView,
} from "../../../lib/impact/compute-impact";
import type { ImpactAudience, ImpactAwardTag, ImpactCategory } from "../../../lib/impact/types";

export type { ImpactView };

function oneOf<T extends string>(allowed: T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : null;
}

function isoDateOrNull(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
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
      computeImpactView(client, { userId: session.user.id, requestedOrg, seasonYear }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load Community Impact. Select a workspace and confirm database access.",
        steps: [
          { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
        ],
        orgId: null,
        seasonYear: seasonYear ?? currentSeasonYear(),
      } satisfies ImpactView,
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
        case "log-activity": {
          const title = trimmedOrNull(body.title, 200);
          const occurredOn = isoDateOrNull(body.occurredOn);
          if (!title) throw new Error("title is required");
          if (!occurredOn) throw new Error("occurredOn (YYYY-MM-DD) is required");
          const category = oneOf<ImpactCategory>(IMPACT_CATEGORIES, body.category) ?? "community_event";
          const audience = oneOf<ImpactAudience>(IMPACT_AUDIENCES, body.audience) ?? "public";
          const evidenceAwards = Array.isArray(body.evidenceAwards)
            ? body.evidenceAwards.filter((tag): tag is ImpactAwardTag => oneOf<ImpactAwardTag>(IMPACT_AWARD_TAGS, tag) != null)
            : [];
          await logActivity(client, {
            orgId,
            userId,
            title,
            category,
            occurredOn,
            durationMinutes: nonNegativeInt(body.durationMinutes),
            participantCount: nonNegativeInt(body.participantCount),
            peopleReached: nonNegativeInt(body.peopleReached),
            audience,
            location: trimmedOrNull(body.location, 200),
            description: trimmedOrNull(body.description, 4000),
            seasonYear,
            evidenceAwards,
          });
          break;
        }
        case "delete-activity": {
          const activityId = trimmedOrNull(body.activityId, 64);
          if (!activityId) throw new Error("activityId is required");
          await deleteActivity(client, { orgId, activityId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeImpactView(client, { userId, requestedOrg: orgId, seasonYear });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Community Impact request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
