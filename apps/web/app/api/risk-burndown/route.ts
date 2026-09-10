import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  RISK_CATEGORIES,
  RISK_STATUSES,
  computeRiskBurndownView,
  currentSeasonYear,
  deleteRisk,
  logRisk,
  updateRiskStatus,
  type RiskBurndownView,
} from "../../../lib/risk-burndown/compute-risk-burndown";
import type { RiskCategory, RiskStatus } from "../../../lib/risk-burndown/types";

export type { RiskBurndownView };

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

function scaleOf5(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(5, Math.max(1, Math.round(n))) : 3;
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
      computeRiskBurndownView(client, { userId: session.user.id, requestedOrg, seasonYear }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load the risk register. Choose your team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
        seasonYear: seasonYear ?? currentSeasonYear(),
      } satisfies RiskBurndownView,
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
        case "log-risk": {
          const title = trimmedOrNull(body.title, 200);
          const identifiedOn = isoDateOrNull(body.identifiedOn);
          if (!title) throw new Error("title is required");
          if (!identifiedOn) throw new Error("identifiedOn (YYYY-MM-DD) is required");
          const category = oneOf<RiskCategory>(RISK_CATEGORIES, body.category) ?? "other";
          const status = oneOf<RiskStatus>(RISK_STATUSES, body.status) ?? "open";
          const closedOn = isoDateOrNull(body.closedOn);
          await logRisk(client, {
            orgId,
            userId,
            title,
            description: trimmedOrNull(body.description, 4000),
            category,
            status,
            likelihood: scaleOf5(body.likelihood),
            impact: scaleOf5(body.impact),
            ownerName: trimmedOrNull(body.ownerName, 120),
            mitigationPlan: trimmedOrNull(body.mitigationPlan, 4000),
            identifiedOn,
            targetCloseDate: isoDateOrNull(body.targetCloseDate),
            closedOn: (status === "closed" || status === "accepted") ? closedOn : null,
            seasonYear,
          });
          break;
        }
        case "update-status": {
          const riskId = trimmedOrNull(body.riskId, 64);
          const status = oneOf<RiskStatus>(RISK_STATUSES, body.status);
          if (!riskId) throw new Error("riskId is required");
          if (!status) throw new Error("status is required");
          const closedOn =
            status === "closed" || status === "accepted"
              ? isoDateOrNull(body.closedOn) ?? new Date().toISOString().slice(0, 10)
              : null;
          await updateRiskStatus(client, { orgId, riskId, status, closedOn });
          break;
        }
        case "delete-risk": {
          const riskId = trimmedOrNull(body.riskId, 64);
          if (!riskId) throw new Error("riskId is required");
          await deleteRisk(client, { orgId, riskId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeRiskBurndownView(client, { userId, requestedOrg: orgId, seasonYear });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Risk-burndown request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
