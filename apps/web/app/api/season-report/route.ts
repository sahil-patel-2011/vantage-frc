import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { SEASON_REPORT_CATEGORIES, SEASON_REPORT_SENTIMENTS } from "../../../lib/season-report";
import {
  computeSeasonReportView,
  currentSeasonYear,
  deleteEntry,
  deleteSnapshot,
  generateSnapshot,
  logEntry,
  type SeasonReportView,
} from "../../../lib/season-report/compute-season-report";
import type { SeasonReportCategory, SeasonReportSentiment } from "../../../lib/season-report/types";
import { failMeteredAi } from "../../../lib/metered-ai-fail";

export type { SeasonReportView };

function oneOf<T extends string>(allowed: T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : null;
}

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function numberOrNull(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
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
      computeSeasonReportView(client, { userId: session.user.id, requestedOrg, seasonYear }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load the season report. Select a workspace and confirm database access.",
        steps: [
          { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
        ],
        orgId: null,
        seasonYear: seasonYear ?? currentSeasonYear(),
      } satisfies SeasonReportView,
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
        case "log-entry": {
          const title = trimmedOrNull(body.title, 200);
          if (!title) throw new Error("title is required");
          const category = oneOf<SeasonReportCategory>(SEASON_REPORT_CATEGORIES, body.category) ?? "lessons";
          const sentiment = oneOf<SeasonReportSentiment>(SEASON_REPORT_SENTIMENTS, body.sentiment) ?? "neutral";
          await logEntry(client, {
            orgId,
            userId,
            seasonYear,
            category,
            title,
            detail: trimmedOrNull(body.detail, 4000),
            metricLabel: trimmedOrNull(body.metricLabel, 100),
            metricValue: numberOrNull(body.metricValue),
            sentiment,
          });
          break;
        }
        case "delete-entry": {
          const entryId = trimmedOrNull(body.entryId, 64);
          if (!entryId) throw new Error("entryId is required");
          await deleteEntry(client, { orgId, entryId });
          break;
        }
        case "generate-snapshot": {
          await generateSnapshot(client, { orgId, userId, seasonYear });
          break;
        }
        case "delete-snapshot": {
          const snapshotId = trimmedOrNull(body.snapshotId, 64);
          if (!snapshotId) throw new Error("snapshotId is required");
          await deleteSnapshot(client, { orgId, snapshotId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeSeasonReportView(client, { userId, requestedOrg: orgId, seasonYear });
    });

    return Response.json(view);
  } catch (error) {
    return failMeteredAi(error, "Season report request failed");
  }
}
