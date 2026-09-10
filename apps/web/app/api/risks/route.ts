import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  RISK_CATEGORIES,
  RISK_STATUSES,
  computeRisksView,
  createRisk,
  currentSeasonYear,
  deleteRisk,
  updateRisk,
  type RisksView,
} from "../../../lib/risks/compute-risks";
import type { RiskCategory, RiskStatus } from "../../../lib/risks/types";

export type { RisksView };

function oneOf<T extends string>(allowed: T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : null;
}

function isoDateOrNull(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function trimmedOrNull(value: unknown, max = 4000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function scaleOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(5, Math.max(1, Math.round(n))) : null;
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
      computeRisksView(client, { userId: session.user.id, requestedOrg, seasonYear }),
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
      } satisfies RisksView,
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
        case "create-risk": {
          const title = trimmedOrNull(body.title, 200);
          if (!title) throw new Error("title is required");
          await createRisk(client, {
            orgId,
            userId,
            seasonYear,
            title,
            category: oneOf<RiskCategory>(RISK_CATEGORIES, body.category) ?? "other",
            likelihood: scaleOrNull(body.likelihood) ?? 3,
            impact: scaleOrNull(body.impact) ?? 3,
            status: oneOf<RiskStatus>(RISK_STATUSES, body.status) ?? "open",
            mitigation: trimmedOrNull(body.mitigation),
            owner: trimmedOrNull(body.owner, 120),
            dueOn: isoDateOrNull(body.dueOn),
            notes: trimmedOrNull(body.notes),
          });
          break;
        }
        case "update-risk": {
          const riskId = trimmedOrNull(body.riskId, 64);
          if (!riskId) throw new Error("riskId is required");
          const category = body.category === undefined ? undefined : oneOf<RiskCategory>(RISK_CATEGORIES, body.category);
          if (body.category !== undefined && !category) throw new Error("Invalid category");
          const status = body.status === undefined ? undefined : oneOf<RiskStatus>(RISK_STATUSES, body.status);
          if (body.status !== undefined && !status) throw new Error("Invalid status");
          await updateRisk(client, {
            orgId,
            riskId,
            title: body.title === undefined ? undefined : (trimmedOrNull(body.title, 200) ?? undefined),
            category: category ?? undefined,
            likelihood: body.likelihood === undefined ? undefined : (scaleOrNull(body.likelihood) ?? undefined),
            impact: body.impact === undefined ? undefined : (scaleOrNull(body.impact) ?? undefined),
            status: status ?? undefined,
            mitigation: body.mitigation === undefined ? undefined : trimmedOrNull(body.mitigation),
            owner: body.owner === undefined ? undefined : trimmedOrNull(body.owner, 120),
            dueOn: body.dueOn === undefined ? undefined : (isoDateOrNull(body.dueOn) ?? undefined),
            notes: body.notes === undefined ? undefined : trimmedOrNull(body.notes),
          });
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

      return computeRisksView(client, { userId, requestedOrg: orgId, seasonYear });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Risk register request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
