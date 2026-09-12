import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  DRIVER_TRYOUTS_ROLES,
  DRIVER_TRYOUTS_STATUSES,
  parseLoggedRubricScores,
} from "../../../lib/driver-tryouts";
import {
  addCandidate,
  addEvaluation,
  computeDriverTryoutsView,
  currentSeasonYear,
  deleteCandidate,
  deleteEvaluation,
  updateCandidateStatus,
  type DriverTryoutsView,
} from "../../../lib/driver-tryouts/compute-driver-tryouts";
import { promoteSelectedCandidateToSeasonRole } from "../../../lib/driver-tryouts/promote-role";
import type { DriverTryoutsRole, DriverTryoutsStatus } from "../../../lib/driver-tryouts/types";

export type { DriverTryoutsView };

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

function requireLoggedScores(body: Record<string, unknown>) {
  const scores = parseLoggedRubricScores({
    scorePrecision: body.scorePrecision,
    scoreAwareness: body.scoreAwareness,
    scoreCommunication: body.scoreCommunication,
    scoreComposure: body.scoreComposure,
    scoreMechanical: body.scoreMechanical,
  });
  if (!scores) throw new Error("each rubric score must be an integer from 1 to 5");
  return scores;
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
      computeDriverTryoutsView(client, { userId: session.user.id, requestedOrg, seasonYear }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load Driver tryouts. Choose your team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
        seasonYear: seasonYear ?? currentSeasonYear(),
      } satisfies DriverTryoutsView,
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
        case "add-candidate": {
          const name = trimmedOrNull(body.name, 200);
          if (!name) throw new Error("name is required");
          const roleInterest = oneOf<DriverTryoutsRole>(DRIVER_TRYOUTS_ROLES, body.roleInterest) ?? "any";
          await addCandidate(client, {
            orgId,
            userId,
            name,
            gradeLevel: trimmedOrNull(body.gradeLevel, 40),
            roleInterest,
            notes: trimmedOrNull(body.notes, 4000),
            seasonYear,
          });
          break;
        }
        case "update-candidate-status": {
          const candidateId = trimmedOrNull(body.candidateId, 64);
          const status = oneOf<DriverTryoutsStatus>(DRIVER_TRYOUTS_STATUSES, body.status);
          if (!candidateId) throw new Error("candidateId is required");
          if (!status) throw new Error("status is invalid");
          await updateCandidateStatus(client, { orgId, candidateId, status });
          if (status === "selected") {
            await promoteSelectedCandidateToSeasonRole(client, {
              orgId,
              userId,
              candidateId,
              status,
              seasonYear,
            });
          }
          break;
        }
        case "delete-candidate": {
          const candidateId = trimmedOrNull(body.candidateId, 64);
          if (!candidateId) throw new Error("candidateId is required");
          await deleteCandidate(client, { orgId, candidateId });
          break;
        }
        case "add-evaluation": {
          const candidateId = trimmedOrNull(body.candidateId, 64);
          const evaluatedOn = isoDateOrNull(body.evaluatedOn);
          if (!candidateId) throw new Error("candidateId is required");
          if (!evaluatedOn) throw new Error("evaluatedOn (YYYY-MM-DD) is required");
          const scores = requireLoggedScores(body);
          await addEvaluation(client, {
            orgId,
            userId,
            candidateId,
            evaluatedOn,
            scorePrecision: scores.precision,
            scoreAwareness: scores.awareness,
            scoreCommunication: scores.communication,
            scoreComposure: scores.composure,
            scoreMechanical: scores.mechanical,
            notes: trimmedOrNull(body.notes, 4000),
          });
          break;
        }
        case "delete-evaluation": {
          const evaluationId = trimmedOrNull(body.evaluationId, 64);
          if (!evaluationId) throw new Error("evaluationId is required");
          await deleteEvaluation(client, { orgId, evaluationId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeDriverTryoutsView(client, { userId, requestedOrg: orgId, seasonYear });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Driver tryouts request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
