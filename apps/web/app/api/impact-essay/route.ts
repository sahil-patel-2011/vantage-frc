import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { IMPACT_ESSAY_AWARDS } from "../../../lib/impact-essay";
import {
  computeImpactEssayView,
  currentSeasonYear,
  deleteEssayDraft,
  generateEssayDraft,
  type ImpactEssayView,
} from "../../../lib/impact-essay/compute-impact-essay";
import type { ImpactEssayAward } from "../../../lib/impact-essay/types";
import { failMeteredAi } from "../../../lib/metered-ai-fail";

export type { ImpactEssayView };

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
      computeImpactEssayView(client, { userId: session.user.id, requestedOrg, seasonYear }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load the Impact essay generator. Choose your team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
        seasonYear: seasonYear ?? currentSeasonYear(),
      } satisfies ImpactEssayView,
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
        case "generate-draft": {
          const award = oneOf<ImpactEssayAward>(IMPACT_ESSAY_AWARDS, body.award) ?? "impact";
          await generateEssayDraft(client, { orgId, userId, award, seasonYear });
          break;
        }
        case "delete-draft": {
          const draftId = trimmedOrNull(body.draftId, 64);
          if (!draftId) throw new Error("draftId is required");
          await deleteEssayDraft(client, { orgId, draftId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeImpactEssayView(client, { userId, requestedOrg: orgId, seasonYear });
    });

    return Response.json(view);
  } catch (error) {
    return failMeteredAi(error, "Impact essay request failed");
  }
}
