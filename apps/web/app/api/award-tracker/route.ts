import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { AWARD_SUBMISSION_STATUSES, AWARD_TYPES } from "../../../lib/award-tracker";
import {
  computeAwardTrackerView,
  createSubmission,
  currentSeasonYear,
  deleteSubmission,
  updateSubmissionStatus,
  type AwardTrackerView,
} from "../../../lib/award-tracker/compute-award-tracker";
import type { AwardSubmissionStatus, AwardType } from "../../../lib/award-tracker/types";

export type { AwardTrackerView };

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
      computeAwardTrackerView(client, { userId: session.user.id, requestedOrg, seasonYear }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load Award Tracker. Select a workspace and confirm database access.",
        steps: [
          { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
        ],
        orgId: null,
        seasonYear: seasonYear ?? currentSeasonYear(),
      } satisfies AwardTrackerView,
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
        case "create-submission": {
          const awardName = trimmedOrNull(body.awardName, 200);
          const eventName = trimmedOrNull(body.eventName, 200);
          if (!awardName) throw new Error("awardName is required");
          if (!eventName) throw new Error("eventName is required");
          const awardType = oneOf<AwardType>(AWARD_TYPES, body.awardType) ?? "other";
          const status = oneOf<AwardSubmissionStatus>(AWARD_SUBMISSION_STATUSES, body.status) ?? "planning";
          await createSubmission(client, {
            orgId,
            userId,
            awardType,
            awardName,
            eventName,
            eventDate: isoDateOrNull(body.eventDate),
            submissionDeadline: isoDateOrNull(body.submissionDeadline),
            status,
            submittedOn: isoDateOrNull(body.submittedOn),
            ownerNote: trimmedOrNull(body.ownerNote, 500),
            notes: trimmedOrNull(body.notes, 4000),
            seasonYear,
          });
          break;
        }
        case "update-status": {
          const submissionId = trimmedOrNull(body.submissionId, 64);
          const status = oneOf<AwardSubmissionStatus>(AWARD_SUBMISSION_STATUSES, body.status);
          if (!submissionId) throw new Error("submissionId is required");
          if (!status) throw new Error("status is required");
          await updateSubmissionStatus(client, {
            orgId,
            submissionId,
            status,
            submittedOn: isoDateOrNull(body.submittedOn),
          });
          break;
        }
        case "delete-submission": {
          const submissionId = trimmedOrNull(body.submissionId, 64);
          if (!submissionId) throw new Error("submissionId is required");
          await deleteSubmission(client, { orgId, submissionId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeAwardTrackerView(client, { userId, requestedOrg: orgId, seasonYear });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Award Tracker request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
