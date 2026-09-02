import { auth, resolveAuthBaseURL } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  EXIT_INTERVIEW_ROLES,
  EXIT_INTERVIEW_STATUSES,
  computeExitInterviewView,
  createExitInvite,
  currentSeasonYear,
  deleteExitInterview,
  logExitInterview,
  revokeExitInvite,
  type ExitInterviewView,
} from "../../../lib/exit-interview/compute-exit-interview";
import { exitInviteLink } from "../../../lib/exit-interview/invites";
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

function uuidOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed) ? trimmed : null;
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

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
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
    const result = await withRls({ userId, orgId }, async (client) => {
      const member = await client.query<{ role: string }>(
        `SELECT role::text AS role FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid`,
        [orgId, userId],
      );
      if (!member.rowCount) throw new HttpError(403, "Organization access denied");
      const role = member.rows[0]!.role;
      const isAdmin = role === "owner" || role === "admin";
      let inviteLink: string | null = null;

      switch (action) {
        case "log-response": {
          const memberName = trimmedOrNull(body.memberName, 200);
          if (!memberName) throw new HttpError(400, "memberName is required");
          const memberUserId = body.memberUserId === undefined || body.memberUserId === "" ? null : uuidOrNull(body.memberUserId);
          if (body.memberUserId && !memberUserId) throw new HttpError(400, "Invalid member");
          const responseRole = oneOf<ExitInterviewRole>(EXIT_INTERVIEW_ROLES, body.role) ?? "other";
          const status = oneOf<ExitInterviewStatus>(EXIT_INTERVIEW_STATUSES, body.status) ?? "submitted";
          await logExitInterview(client, {
            orgId,
            userId,
            memberName,
            memberUserId,
            role: responseRole,
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
          if (!recordId) throw new HttpError(400, "recordId is required");
          await deleteExitInterview(client, { orgId, recordId });
          break;
        }
        case "invite": {
          if (!isAdmin) throw new HttpError(403, "Only an owner or admin can create self-serve exit interview links.");
          const memberUserId = body.memberUserId === undefined || body.memberUserId === "" ? null : uuidOrNull(body.memberUserId);
          if (body.memberUserId && !memberUserId) throw new HttpError(400, "Invalid member");
          let memberName = trimmedOrNull(body.memberName, 200);
          const memberEmail = trimmedOrNull(body.memberEmail, 254)?.toLowerCase() ?? null;
          if (memberEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(memberEmail)) throw new HttpError(400, "Invalid email");
          if (memberUserId && !memberName) {
            const named = await client.query<{ name: string }>(
              `SELECT COALESCE(NULLIF(btrim(u.name), ''), u.email) AS name
               FROM memberships m JOIN users u ON u.id = m.user_id
               WHERE m.org_id = $1::uuid AND m.user_id = $2::uuid`,
              [orgId, memberUserId],
            );
            memberName = named.rows[0]?.name ?? null;
          }
          if (!memberName) throw new HttpError(400, "memberName is required");
          const created = await createExitInvite(client, {
            orgId,
            userId,
            memberName,
            memberUserId,
            memberEmail,
            seasonYear,
          });
          inviteLink = exitInviteLink(resolveAuthBaseURL(), created.token);
          break;
        }
        case "revoke-invite": {
          if (!isAdmin) throw new HttpError(403, "Only an owner or admin can revoke exit interview links.");
          const inviteId = uuidOrNull(body.inviteId);
          if (!inviteId) throw new HttpError(400, "inviteId is required");
          await revokeExitInvite(client, { orgId, inviteId });
          break;
        }
        default:
          throw new HttpError(400, "Unknown action");
      }

      const view = await computeExitInterviewView(client, { userId, requestedOrg: orgId, seasonYear });
      return inviteLink ? { ...view, inviteLink } : view;
    });

    return Response.json(result);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 400;
    const message = error instanceof Error ? error.message : "Exit Interview request failed";
    return Response.json({ error: message }, { status });
  }
}
