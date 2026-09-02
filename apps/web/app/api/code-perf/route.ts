import type { RenderOutcome } from "@vantage/agent";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  CHANGE_TYPES,
  SUBSYSTEMS,
  analyzeChange,
  computeCodePerfView,
  currentSeasonYear,
  deleteChange,
  deleteMatchResult,
  logChange,
  logMatchResult,
  type CodePerfView,
} from "../../../lib/code-perf/compute-code-perf";
import type { ChangeType, Subsystem } from "../../../lib/code-perf/types";
import { failMeteredAi } from "../../../lib/metered-ai-fail";

export type { CodePerfView };

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
      computeCodePerfView(client, { userId: session.user.id, requestedOrg, seasonYear }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load Code-vs-Match Detective. Select a workspace and confirm database access.",
        steps: [
          { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
        ],
        orgId: null,
        seasonYear: seasonYear ?? currentSeasonYear(),
      } satisfies CodePerfView,
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

      let render: RenderOutcome | undefined;
      switch (action) {
        case "log-change": {
          const title = trimmedOrNull(body.title, 200);
          const occurredOn = isoDateOrNull(body.occurredOn);
          if (!title) throw new Error("title is required");
          if (!occurredOn) throw new Error("occurredOn (YYYY-MM-DD) is required");
          const changeType = oneOf<ChangeType>(CHANGE_TYPES, body.changeType) ?? "commit";
          const subsystem = oneOf<Subsystem>(SUBSYSTEMS, body.subsystem) ?? "general";
          await logChange(client, {
            orgId,
            userId,
            seasonYear,
            occurredOn,
            changeType,
            subsystem,
            title,
            commitSha: trimmedOrNull(body.commitSha, 64),
            repoUrl: trimmedOrNull(body.repoUrl, 500),
            description: trimmedOrNull(body.description, 4000),
          });
          break;
        }
        case "delete-change": {
          const changeId = trimmedOrNull(body.changeId, 64);
          if (!changeId) throw new Error("changeId is required");
          await deleteChange(client, { orgId, changeId });
          break;
        }
        case "analyze-change": {
          const changeId = trimmedOrNull(body.changeId, 64);
          if (!changeId) throw new Error("changeId is required");
          render = await analyzeChange(client, { orgId, userId, changeId });
          break;
        }
        case "log-match-result": {
          const matchKey = trimmedOrNull(body.matchKey, 100);
          const occurredOn = isoDateOrNull(body.occurredOn);
          if (!matchKey) throw new Error("matchKey is required");
          if (!occurredOn) throw new Error("occurredOn (YYYY-MM-DD) is required");
          await logMatchResult(client, {
            orgId,
            userId,
            seasonYear,
            occurredOn,
            matchKey,
            eventKey: trimmedOrNull(body.eventKey, 40),
            autoPoints: nonNegativeNumber(body.autoPoints),
            teleopPoints: nonNegativeNumber(body.teleopPoints),
            endgamePoints: nonNegativeNumber(body.endgamePoints),
            notes: trimmedOrNull(body.notes, 2000),
          });
          break;
        }
        case "delete-match-result": {
          const matchResultId = trimmedOrNull(body.matchResultId, 64);
          if (!matchResultId) throw new Error("matchResultId is required");
          await deleteMatchResult(client, { orgId, matchResultId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      const view = await computeCodePerfView(client, { userId, requestedOrg: orgId, seasonYear });
      return render ? { ...view, render } : view;
    });

    return Response.json(view);
  } catch (error) {
    return failMeteredAi(error, "Code-vs-Match Detective request failed");
  }
}
