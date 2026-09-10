import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  DEPLOY_STATUSES,
  DEPLOY_TYPES,
  computeCodeDeployLogView,
  currentSeasonYear,
  deleteDeploy,
  logDeploy,
  type CodeDeployLogView,
} from "../../../lib/code-deploy-log/compute-code-deploy-log";
import type { DeployStatus, DeployType } from "../../../lib/code-deploy-log/types";

export type { CodeDeployLogView };

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
      computeCodeDeployLogView(client, { userId: session.user.id, requestedOrg, seasonYear }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load the code deploy log. Select a team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
        seasonYear: seasonYear ?? currentSeasonYear(),
      } satisfies CodeDeployLogView,
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
        case "log-deploy": {
          const deployedOn = isoDateOrNull(body.deployedOn);
          const firmwareVersion = trimmedOrNull(body.firmwareVersion, 200);
          if (!deployedOn) throw new Error("deployedOn (YYYY-MM-DD) is required");
          if (!firmwareVersion) throw new Error("firmwareVersion is required");
          const deployType = oneOf<DeployType>(DEPLOY_TYPES, body.deployType) ?? "practice";
          const status = oneOf<DeployStatus>(DEPLOY_STATUSES, body.status) ?? "deployed";
          await logDeploy(client, {
            orgId,
            userId,
            seasonYear,
            deployedOn,
            matchKey: trimmedOrNull(body.matchKey, 64),
            eventKey: trimmedOrNull(body.eventKey, 64),
            firmwareVersion,
            commitSha: trimmedOrNull(body.commitSha, 64),
            branch: trimmedOrNull(body.branch, 120),
            deployType,
            status,
            notes: trimmedOrNull(body.notes, 4000),
          });
          break;
        }
        case "delete-deploy": {
          const entryId = trimmedOrNull(body.entryId, 64);
          if (!entryId) throw new Error("entryId is required");
          await deleteDeploy(client, { orgId, entryId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeCodeDeployLogView(client, { userId, requestedOrg: orgId, seasonYear });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Code deploy log request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
