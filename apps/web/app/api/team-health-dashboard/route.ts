import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  computeTeamHealthDashboardView,
  currentSeasonYear,
  deletePulse,
  logPulse,
  type TeamHealthDashboardView,
} from "../../../lib/team-health-dashboard/compute-team-health-dashboard";

export type { TeamHealthDashboardView };

function isoDateOrNull(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function boundedInt(value: unknown, min: number, max: number, fallback = min): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
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
      computeTeamHealthDashboardView(client, { userId: session.user.id, requestedOrg, seasonYear }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load the Team Health Dashboard. Select a workspace and confirm database access.",
        steps: [
          { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
        ],
        orgId: null,
        seasonYear: seasonYear ?? currentSeasonYear(),
      } satisfies TeamHealthDashboardView,
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
        case "log-pulse": {
          const periodLabel = trimmedOrNull(body.periodLabel, 60);
          const periodStart = isoDateOrNull(body.periodStart);
          if (!periodLabel) throw new Error("periodLabel is required");
          if (!periodStart) throw new Error("periodStart (YYYY-MM-DD) is required");
          await logPulse(client, {
            orgId,
            userId,
            periodLabel,
            periodStart,
            attendanceRate: boundedInt(body.attendanceRate, 0, 100),
            membersPresent: boundedInt(body.membersPresent, 0, 10000),
            membersTotal: boundedInt(body.membersTotal, 0, 10000),
            tasksCompleted: boundedInt(body.tasksCompleted, 0, 100000),
            tasksOpen: boundedInt(body.tasksOpen, 0, 100000),
            tasksOverdue: boundedInt(body.tasksOverdue, 0, 100000),
            engagementScore: boundedInt(body.engagementScore, 0, 100),
            moraleRating: boundedInt(body.moraleRating, 1, 5, 3),
            seasonYear,
            notes: trimmedOrNull(body.notes, 4000),
          });
          break;
        }
        case "delete-pulse": {
          const pulseId = trimmedOrNull(body.pulseId, 64);
          if (!pulseId) throw new Error("pulseId is required");
          await deletePulse(client, { orgId, pulseId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeTeamHealthDashboardView(client, { userId, requestedOrg: orgId, seasonYear });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Team Health Dashboard request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
