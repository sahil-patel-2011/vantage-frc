import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { failMeteredAi } from "../../../lib/metered-ai-fail";
import {
  computeSketchToBriefView,
  currentSeasonYear,
  deleteSketch,
  generateBriefFromSketch,
  logSketch,
  type SketchToBriefView,
} from "../../../lib/sketch-to-brief/compute-sketch-to-brief";

export type { SketchToBriefView };

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
      computeSketchToBriefView(client, { userId: session.user.id, requestedOrg, seasonYear }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load Sketch-to-Brief. Select a workspace and confirm database access.",
        steps: [
          { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
        ],
        orgId: null,
        seasonYear: seasonYear ?? currentSeasonYear(),
      } satisfies SketchToBriefView,
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
        case "log-sketch": {
          const title = trimmedOrNull(body.title, 200);
          const notes = trimmedOrNull(body.notes, 6000);
          if (!title) throw new Error("title is required");
          if (!notes) throw new Error("notes (transcribed sketch) is required");
          await logSketch(client, { orgId, userId, title, notes, seasonYear });
          return computeSketchToBriefView(client, { userId, requestedOrg: orgId, seasonYear });
        }
        case "generate-brief": {
          const sketchId = trimmedOrNull(body.sketchId, 64);
          if (!sketchId) throw new Error("sketchId is required");
          return generateBriefFromSketch(client, { userId, requestedOrg: orgId, sketchId });
        }
        case "delete-sketch": {
          const sketchId = trimmedOrNull(body.sketchId, 64);
          if (!sketchId) throw new Error("sketchId is required");
          await deleteSketch(client, { orgId, sketchId });
          return computeSketchToBriefView(client, { userId, requestedOrg: orgId, seasonYear });
        }
        default:
          throw new Error("Unknown action");
      }
    });

    return Response.json(view);
  } catch (error) {
    return failMeteredAi(error, "Sketch-to-Brief request failed");
  }
}
