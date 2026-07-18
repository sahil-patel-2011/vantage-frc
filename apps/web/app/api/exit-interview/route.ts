import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  EXIT_INTERVIEW_ROLES,
  EXIT_INTERVIEW_STATUSES,
  computeExitInterviewView,
  currentSeasonYear,
  deleteExitInterview,
  logExitInterview,
  type ExitInterviewView,
} from "../../../lib/exit-interview/compute-exit-interview";
import type { ExitInterviewRole, ExitInterviewStatus } from "../../../lib/exit-interview/types";

export type { ExitInterviewView };

function oneOf<T extends string>(allowed: T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : null;
}

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function nonNegativeInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

function seasonFrom(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 2000 && n < 3000 ? Math.round(n) : currentSeasonYear();
}

function yearFrom(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 2000 && n < 3000 ? Math.round(n) : fallback;
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
      computeExitInterviewView(client, { userId: session.user.id, requestedOrg, seasonYear }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load Exit Interviews. Select a workspace and confirm database access.",
        steps: [
          { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
        ],
        orgId: null,
        seasonYear: seasonYear ?? currentSeasonYear(),
      } satisfies ExitInterviewView,
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
        case "log-response": {
          const memberName = trimmedOrNull(body.memberName, 200);
          if (!memberName) throw new Error("memberName is required");
          const role = oneOf<ExitInterviewRole>(EXIT_INTERVIEW_ROLES, body.role) ?? "other";
          const status = oneOf<ExitInterviewStatus>(EXIT_INTERVIEW_STATUSES, body.status) ?? "submitted";
          await logExitInterview(client, {
            orgId,
            userId,
            memberName,
            role,
            yearsOnTeam: nonNegativeInt(body.yearsOnTeam),
            graduationYear: yearFrom(body.graduationYear, seasonYear),
            seasonYear,
            highlights: trimmedOrNull(body.highlights, 4000),
            adviceForFuture: trimmedOrNull(body.adviceForFuture, 4000),
            skillsToDocument: trimmedOrNull(body.skillsToDocument, 4000),
            willingToMentor: body.willingToMentor === true,
            contactEmail: trimmedOrNull(body.contactEmail, 200),
            status,
          });
          break;
        }
        case "delete-response": {
          const recordId = trimmedOrNull(body.recordId, 64);
          if (!recordId) throw new Error("recordId is required");
          await deleteExitInterview(client, { orgId, recordId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeExitInterviewView(client, { userId, requestedOrg: orgId, seasonYear });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Exit Interview request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
