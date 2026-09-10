import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  DECISION_STATUSES,
  TEST_OUTCOMES,
  computePrototypeTrackerView,
  currentSeasonYear,
  deleteDecision,
  deleteTest,
  draftDecisionForTest,
  logTest,
  updateDecisionStatus,
  type PrototypeTrackerView,
} from "../../../lib/prototype-tracker/compute-prototype-tracker";
import type { DecisionStatus, TestOutcome } from "../../../lib/prototype-tracker/types";
import { failMeteredAi } from "../../../lib/metered-ai-fail";

export type { PrototypeTrackerView };

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

function trimmedOrEmpty(value: unknown, max = 2000): string {
  return trimmedOrNull(value, max) ?? "";
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
      computePrototypeTrackerView(client, { userId: session.user.id, requestedOrg, seasonYear }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load the prototype tracker. Select a team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
        seasonYear: seasonYear ?? currentSeasonYear(),
      } satisfies PrototypeTrackerView,
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
        case "log-test": {
          const subsystemName = trimmedOrNull(body.subsystemName, 200);
          const title = trimmedOrNull(body.title, 200);
          const testDate = isoDateOrNull(body.testDate);
          if (!subsystemName) throw new Error("subsystemName is required");
          if (!title) throw new Error("title is required");
          if (!testDate) throw new Error("testDate (YYYY-MM-DD) is required");
          const outcome = oneOf<TestOutcome>(TEST_OUTCOMES, body.outcome) ?? "inconclusive";
          await logTest(client, {
            orgId,
            userId,
            seasonYear,
            subsystemName,
            title,
            hypothesis: trimmedOrEmpty(body.hypothesis, 2000),
            testDate,
            outcome,
            resultSummary: trimmedOrEmpty(body.resultSummary, 4000),
            metricLabel: trimmedOrNull(body.metricLabel, 100),
            metricValue: numberOrNull(body.metricValue),
            metricTarget: numberOrNull(body.metricTarget),
          });
          break;
        }
        case "draft-decision": {
          const testId = trimmedOrNull(body.testId, 64);
          const decisionTitle = trimmedOrNull(body.decisionTitle, 200);
          if (!testId) throw new Error("testId is required");
          if (!decisionTitle) throw new Error("decisionTitle is required");
          await draftDecisionForTest(client, { orgId, userId, testId, decisionTitle });
          break;
        }
        case "update-decision-status": {
          const decisionId = trimmedOrNull(body.decisionId, 64);
          if (!decisionId) throw new Error("decisionId is required");
          const status = oneOf<DecisionStatus>(DECISION_STATUSES, body.status);
          if (!status) throw new Error("status must be one of draft, finalized");
          await updateDecisionStatus(client, { orgId, decisionId, status });
          break;
        }
        case "delete-test": {
          const testId = trimmedOrNull(body.testId, 64);
          if (!testId) throw new Error("testId is required");
          await deleteTest(client, { orgId, testId });
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

      return computePrototypeTrackerView(client, { userId, requestedOrg: orgId, seasonYear });
    });

    return Response.json(view);
  } catch (error) {
    return failMeteredAi(error, "Prototype tracker request failed");
  }
}
