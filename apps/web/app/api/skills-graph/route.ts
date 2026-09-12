import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  PROFICIENCY_LEVELS,
  SKILL_CATEGORIES,
  addSkillEntry,
  closeMentorRequest,
  computeSkillsGraphView,
  deleteSkillEntry,
  requestMentor,
  type SkillsGraphView,
} from "../../../lib/skills-graph/compute-skills-graph";
import type { ProficiencyLevel, SkillCategory } from "../../../lib/skills-graph/types";
import { failMeteredAi } from "../../../lib/metered-ai-fail";

export type { SkillsGraphView };

function oneOf<T extends string>(allowed: T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : null;
}

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeSkillsGraphView(client, { userId: session.user.id, requestedOrg }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load the skills and mentorship graph. Choose your team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
      } satisfies SkillsGraphView,
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
        case "add-skill": {
          const targetUserId = trimmedOrNull(body.targetUserId, 64);
          const skillCategory = oneOf<SkillCategory>(SKILL_CATEGORIES, body.skillCategory);
          if (!targetUserId) throw new Error("targetUserId is required");
          if (!skillCategory) throw new Error("A valid skillCategory is required");
          const proficiency = oneOf<ProficiencyLevel>(PROFICIENCY_LEVELS, body.proficiency) ?? "developing";
          const targetMember = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2`, [
            orgId,
            targetUserId,
          ]);
          if (!targetMember.rowCount) throw new Error("Target member is not part of this team");
          await addSkillEntry(client, {
            orgId,
            userId,
            targetUserId,
            skillCategory,
            customLabel: trimmedOrNull(body.customLabel, 120),
            proficiency,
            evidenceNote: trimmedOrNull(body.evidenceNote, 1000),
          });
          break;
        }
        case "delete-skill": {
          const entryId = trimmedOrNull(body.entryId, 64);
          if (!entryId) throw new Error("entryId is required");
          await deleteSkillEntry(client, { orgId, entryId });
          break;
        }
        case "request-mentor": {
          const skillCategory = oneOf<SkillCategory>(SKILL_CATEGORIES, body.skillCategory);
          if (!skillCategory) throw new Error("A valid skillCategory is required");
          await requestMentor(client, {
            orgId,
            userId,
            skillCategory,
            note: trimmedOrNull(body.note, 1000),
          });
          break;
        }
        case "close-request": {
          const requestId = trimmedOrNull(body.requestId, 64);
          if (!requestId) throw new Error("requestId is required");
          await closeMentorRequest(client, { orgId, requestId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeSkillsGraphView(client, { userId, requestedOrg: orgId });
    });

    return Response.json(view);
  } catch (error) {
    return failMeteredAi(error, "Skills graph request failed");
  }
}
