import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  computeMatchSimView,
  deleteRun,
  saveRun,
  simulateMatch,
  type MatchSimView,
} from "../../../lib/match-sim/compute-match-sim";

export type { MatchSimView };

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function teamKeyList(value: unknown, max = 4): string[] {
  if (!Array.isArray(value)) return [];
  const keys = value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim().toLowerCase())
    .filter((v) => /^frc\d+$/.test(v));
  return Array.from(new Set(keys)).slice(0, max);
}

function yearFrom(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 2000 && n < 3000 ? Math.round(n) : null;
}

function setupResponse(message: string): MatchSimView {
  return {
    status: "setup_required",
    message,
    steps: [
      { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
      { id: "reference", label: "Sync reference data", detail: "Confirm official event numbers and season ratings have synced for your event", href: "/rankings" },
    ],
    orgId: null,
  };
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");
  const activeRunId = url.searchParams.get("runId");

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeMatchSimView(client, { userId: session.user.id, requestedOrg, activeRunId }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      setupResponse("Could not load the match simulator. Choose your team and confirm database access."),
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
        case "simulate": {
          const redTeamKeys = teamKeyList(body.redTeamKeys);
          const blueTeamKeys = teamKeyList(body.blueTeamKeys);
          if (redTeamKeys.length === 0 || blueTeamKeys.length === 0) {
            throw new Error("Select at least one team on each alliance (frcNNNN keys)");
          }
          const eventKey = trimmedOrNull(body.eventKey, 40);
          const matchKey = trimmedOrNull(body.matchKey, 60);
          const label = trimmedOrNull(body.label, 120) ?? `Red ${redTeamKeys.join(", ")} vs Blue ${blueTeamKeys.join(", ")}`;
          const year = yearFrom(body.year);

          const result = await simulateMatch(client, { redTeamKeys, blueTeamKeys, eventKey, year });
          await saveRun(client, {
            orgId,
            userId,
            label,
            eventKey,
            matchKey,
            redTeamKeys,
            blueTeamKeys,
            result,
          });
          break;
        }
        case "delete-run": {
          const runId = trimmedOrNull(body.runId, 64);
          if (!runId) throw new Error("runId is required");
          await deleteRun(client, { orgId, runId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      const activeRunId = typeof body.activeRunId === "string" ? body.activeRunId : null;
      return computeMatchSimView(client, { userId, requestedOrg: orgId, activeRunId });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Match simulator request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json({ error: message === "forbidden" ? "Organization access denied" : message }, { status });
  }
}
