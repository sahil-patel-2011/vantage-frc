import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { failMeteredAi } from "../../../lib/metered-ai-fail";
import {
  RULE_CHANGE_CATEGORIES,
  RULE_CHANGE_SEVERITIES,
  RULE_IMPACT_ASSESSMENT_STATUSES,
  SUBSYSTEM_CATEGORIES,
  computeRuleImpactView,
  currentSeasonYear,
  deleteAssessment,
  deleteRuleChange,
  logRuleChange,
  recordAssessment,
  updateAssessmentStatus,
  type RuleImpactView,
} from "../../../lib/rule-impact/compute-rule-impact";
import type {
  RuleChangeCategory,
  RuleChangeSeverity,
  RuleImpactAssessmentStatus,
  SubsystemCategory,
} from "../../../lib/rule-impact/types";

export type { RuleImpactView };

function oneOf<T extends string>(allowed: T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : null;
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
      computeRuleImpactView(client, { userId: session.user.id, requestedOrg, seasonYear }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load the Rule Impact analyzer. Select a team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
        seasonYear: seasonYear ?? currentSeasonYear(),
      } satisfies RuleImpactView,
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
        case "log-rule-change": {
          const ruleCode = trimmedOrNull(body.ruleCode, 40);
          const title = trimmedOrNull(body.title, 200);
          if (!ruleCode) throw new Error("ruleCode is required");
          if (!title) throw new Error("title is required");
          const category = oneOf<RuleChangeCategory>(RULE_CHANGE_CATEGORIES, body.category) ?? "other";
          const severity = oneOf<RuleChangeSeverity>(RULE_CHANGE_SEVERITIES, body.severity) ?? "minor";
          const subsystemCategory = oneOf<SubsystemCategory>(SUBSYSTEM_CATEGORIES, body.subsystemCategory);
          await logRuleChange(client, {
            orgId,
            userId,
            seasonYear,
            ruleCode,
            title,
            category,
            severity,
            subsystemCategory,
            summary: trimmedOrNull(body.summary, 4000) ?? "",
            sourceUrl: trimmedOrNull(body.sourceUrl, 500),
          });
          break;
        }
        case "delete-rule-change": {
          const ruleChangeId = trimmedOrNull(body.ruleChangeId, 64);
          if (!ruleChangeId) throw new Error("ruleChangeId is required");
          await deleteRuleChange(client, { orgId, ruleChangeId });
          break;
        }
        case "assess": {
          const subsystemName = trimmedOrNull(body.subsystemName, 200);
          if (!subsystemName) throw new Error("subsystemName is required");
          const category = oneOf<SubsystemCategory>(SUBSYSTEM_CATEGORIES, body.category) ?? "other";
          const subsystemId = trimmedOrNull(body.subsystemId, 64);
          const sourceSeasonYear = Number.isFinite(Number(body.sourceSeasonYear))
            ? Math.round(Number(body.sourceSeasonYear))
            : null;
          await recordAssessment(client, {
            orgId,
            userId,
            seasonYear,
            subsystemId,
            subsystemName,
            category,
            sourceSeasonYear,
            notes: trimmedOrNull(body.notes, 2000),
          });
          break;
        }
        case "update-status": {
          const assessmentId = trimmedOrNull(body.assessmentId, 64);
          const status = oneOf<RuleImpactAssessmentStatus>(RULE_IMPACT_ASSESSMENT_STATUSES, body.status);
          if (!assessmentId) throw new Error("assessmentId is required");
          if (!status) throw new Error("status is required");
          await updateAssessmentStatus(client, { orgId, assessmentId, status });
          break;
        }
        case "delete-assessment": {
          const assessmentId = trimmedOrNull(body.assessmentId, 64);
          if (!assessmentId) throw new Error("assessmentId is required");
          await deleteAssessment(client, { orgId, assessmentId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeRuleImpactView(client, { userId, requestedOrg: orgId, seasonYear });
    });

    return Response.json(view);
  } catch (error) {
    return failMeteredAi(error, "Rule Impact request failed");
  }
}
