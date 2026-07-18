import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { isAllianceSimRole } from "../../../lib/alliance-sim";
import {
  addRobot,
  computeAllianceSimView,
  createScenario,
  currentSeasonYear,
  deleteRobot,
  deleteScenario,
  type AllianceSimView,
} from "../../../lib/alliance-sim/compute-alliance-sim";
import type { AllianceSimRole } from "../../../lib/alliance-sim/types";

export type { AllianceSimView };

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function seasonFrom(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 2000 && n < 3000 ? Math.round(n) : currentSeasonYear();
}

function positiveIntOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function rolesFrom(value: unknown): AllianceSimRole[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<AllianceSimRole>();
  for (const item of value) {
    if (isAllianceSimRole(item)) seen.add(item);
  }
  return Array.from(seen);
}

function strengthsFrom(value: unknown): Partial<Record<AllianceSimRole, number>> {
  if (!value || typeof value !== "object") return {};
  const out: Partial<Record<AllianceSimRole, number>> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!isAllianceSimRole(key)) continue;
    const n = Number(raw);
    if (Number.isFinite(n)) out[key] = Math.min(5, Math.max(1, Math.round(n)));
  }
  return out;
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");
  const requestedScenario = url.searchParams.get("scenarioId");

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeAllianceSimView(client, { userId: session.user.id, requestedOrg, requestedScenario }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load Alliance Sim. Select a workspace and confirm database access.",
        steps: [
          { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
        ],
        orgId: null,
      } satisfies AllianceSimView,
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

      let selectedScenario = trimmedOrNull(body.scenarioId, 64);

      switch (action) {
        case "create-scenario": {
          const name = trimmedOrNull(body.name, 200);
          if (!name) throw new Error("name is required");
          selectedScenario = await createScenario(client, {
            orgId,
            userId,
            name,
            eventName: trimmedOrNull(body.eventName, 200),
            seasonYear: seasonFrom(body.seasonYear),
            notes: trimmedOrNull(body.notes, 2000),
          });
          break;
        }
        case "delete-scenario": {
          const scenarioId = trimmedOrNull(body.scenarioId, 64);
          if (!scenarioId) throw new Error("scenarioId is required");
          await deleteScenario(client, { orgId, scenarioId });
          selectedScenario = null;
          break;
        }
        case "add-robot": {
          const scenarioId = trimmedOrNull(body.scenarioId, 64);
          const teamNumber = positiveIntOrNull(body.teamNumber);
          if (!scenarioId) throw new Error("scenarioId is required");
          if (!teamNumber) throw new Error("teamNumber is required");
          await addRobot(client, {
            orgId,
            scenarioId,
            teamNumber,
            teamName: trimmedOrNull(body.teamName, 200),
            capableRoles: rolesFrom(body.capableRoles),
            roleStrengths: strengthsFrom(body.roleStrengths),
          });
          selectedScenario = scenarioId;
          break;
        }
        case "delete-robot": {
          const robotId = trimmedOrNull(body.robotId, 64);
          if (!robotId) throw new Error("robotId is required");
          await deleteRobot(client, { orgId, robotId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeAllianceSimView(client, { userId, requestedOrg: orgId, requestedScenario: selectedScenario });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Alliance Sim request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}

