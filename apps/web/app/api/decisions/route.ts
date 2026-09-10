import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  DECISION_CATEGORIES,
  DECISION_STATUSES,
  computeDecisionsView,
  createDecision,
  currentSeasonYear,
  deleteDecision,
  updateDecision,
  type DecisionsView,
} from "../../../lib/decisions/compute-decisions";
import type { DecisionCategory, DecisionStatus } from "../../../lib/decisions/types";

export type { DecisionsView };

function oneOf<T extends string>(allowed: T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : null;
}

function isoDateOrNull(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function trimmedOrNull(value: unknown, max = 8000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function optionsFrom(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim().slice(0, 300)).slice(0, 20);
  }
  if (typeof value === "string") {
    return value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.slice(0, 300))
      .slice(0, 20);
  }
  return [];
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
      computeDecisionsView(client, { userId: session.user.id, requestedOrg, seasonYear }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load the decision log. Select a team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
        seasonYear: seasonYear ?? currentSeasonYear(),
      } satisfies DecisionsView,
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
        case "create-decision": {
          const title = trimmedOrNull(body.title, 200);
          if (!title) throw new Error("title is required");
          const status = oneOf<DecisionStatus>(DECISION_STATUSES, body.status) ?? "proposed";
          await createDecision(client, {
            orgId,
            userId,
            seasonYear,
            title,
            category: oneOf<DecisionCategory>(DECISION_CATEGORIES, body.category) ?? "design",
            status,
            context: trimmedOrNull(body.context),
            decision: trimmedOrNull(body.decision),
            rationale: trimmedOrNull(body.rationale),
            options: optionsFrom(body.options),
            decidedOn: isoDateOrNull(body.decidedOn) ?? (status === "accepted" || status === "rejected" ? currentIso() : null),
            deciders: trimmedOrNull(body.deciders, 300),
            supersedesId: trimmedOrNull(body.supersedesId, 64),
            notes: trimmedOrNull(body.notes),
          });
          break;
        }
        case "update-decision": {
          const decisionId = trimmedOrNull(body.decisionId, 64);
          if (!decisionId) throw new Error("decisionId is required");
          const category = body.category === undefined ? undefined : oneOf<DecisionCategory>(DECISION_CATEGORIES, body.category);
          if (body.category !== undefined && !category) throw new Error("Invalid category");
          const status = body.status === undefined ? undefined : oneOf<DecisionStatus>(DECISION_STATUSES, body.status);
          if (body.status !== undefined && !status) throw new Error("Invalid status");
          await updateDecision(client, {
            orgId,
            decisionId,
            title: body.title === undefined ? undefined : (trimmedOrNull(body.title, 200) ?? undefined),
            category: category ?? undefined,
            status: status ?? undefined,
            context: body.context === undefined ? undefined : trimmedOrNull(body.context),
            decision: body.decision === undefined ? undefined : trimmedOrNull(body.decision),
            rationale: body.rationale === undefined ? undefined : trimmedOrNull(body.rationale),
            options: body.options === undefined ? undefined : optionsFrom(body.options),
            decidedOn: body.decidedOn === undefined ? undefined : isoDateOrNull(body.decidedOn),
            deciders: body.deciders === undefined ? undefined : trimmedOrNull(body.deciders, 300),
            supersedesId: body.supersedesId === undefined ? undefined : trimmedOrNull(body.supersedesId, 64),
            notes: body.notes === undefined ? undefined : trimmedOrNull(body.notes),
          });
          break;
        }
        case "delete-decision": {
          const decisionId = trimmedOrNull(body.decisionId, 64);
          if (!decisionId) throw new Error("decisionId is required");
          await deleteDecision(client, { orgId, decisionId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeDecisionsView(client, { userId, requestedOrg: orgId, seasonYear });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Decision log request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}

function currentIso(): string {
  return new Date().toISOString().slice(0, 10);
}
