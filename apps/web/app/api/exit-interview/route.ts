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
  updateExitInterview,
  type ExitInterviewView,
} from "../../../lib/exit-interview/compute-exit-interview";
import { ExitInterviewError } from "../../../lib/exit-interview/lifecycle";
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
        message: "Could not load Exit Interviews. Choose your team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
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
      const member = await client.query<{ role: string }>(
        `SELECT role::text AS role FROM memberships WHERE org_id = $1 AND user_id = $2`,
        [orgId, userId],
      );
      const actorRole = member.rows[0]?.role;
      if (!actorRole) throw new Error("forbidden");

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
            memberUserId: trimmedOrNull(body.memberUserId, 64),
          });
          break;
        }
        // Finishing a draft started earlier, or a mentor correcting a submitted record. Sending
        // only `{ recordId, status: "submitted" }` publishes the handoff page without the client
        // having to resend every answer.
        case "update-response":
        case "submit-response": {
          const recordId = trimmedOrNull(body.recordId, 64);
          if (!recordId) throw new Error("recordId is required");
          await updateExitInterview(client, {
            orgId,
            userId,
            actorRole,
            recordId,
            memberName: trimmedOrNull(body.memberName, 200),
            memberUserId:
              body.memberUserId === undefined ? undefined : trimmedOrNull(body.memberUserId, 64),
            role: oneOf<ExitInterviewRole>(EXIT_INTERVIEW_ROLES, body.role),
            yearsOnTeam: body.yearsOnTeam === undefined ? null : nonNegativeInt(body.yearsOnTeam),
            graduationYear:
              body.graduationYear === undefined ? null : yearFrom(body.graduationYear, seasonYear),
            highlights: body.highlights === undefined ? undefined : trimmedOrNull(body.highlights, 4000),
            adviceForFuture:
              body.adviceForFuture === undefined ? undefined : trimmedOrNull(body.adviceForFuture, 4000),
            skillsToDocument:
              body.skillsToDocument === undefined ? undefined : trimmedOrNull(body.skillsToDocument, 4000),
            willingToMentor: typeof body.willingToMentor === "boolean" ? body.willingToMentor : null,
            contactEmail:
              body.contactEmail === undefined ? undefined : trimmedOrNull(body.contactEmail, 200),
            status:
              action === "submit-response"
                ? "submitted"
                : oneOf<ExitInterviewStatus>(EXIT_INTERVIEW_STATUSES, body.status),
          });
          break;
        }
        case "delete-response": {
          const recordId = trimmedOrNull(body.recordId, 64);
          if (!recordId) throw new Error("recordId is required");
          await deleteExitInterview(client, { orgId, recordId, actorRole, userId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeExitInterviewView(client, { userId, requestedOrg: orgId, seasonYear });
    });

    return Response.json(view);
  } catch (error) {
    if (error instanceof ExitInterviewError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Exit Interview request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
