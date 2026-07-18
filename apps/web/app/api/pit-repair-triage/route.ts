import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  TRIAGE_STATUSES,
  computePitRepairTriageView,
  currentSeasonYear,
  deleteReport,
  logFailure,
  updateReportStatus,
  type PitRepairTriageView,
} from "../../../lib/pit-repair-triage/compute-pit-repair-triage";
import type { TriageStatus } from "../../../lib/pit-repair-triage/types";
import { failMeteredAi } from "../../../lib/metered-ai-fail";

export type { PitRepairTriageView };

function oneOf<T extends string>(allowed: T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : null;
}

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function trimmedOrEmpty(value: unknown, max = 2000): string {
  return trimmedOrNull(value, max) ?? "";
}

function nonNegativeInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
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
      computePitRepairTriageView(client, { userId: session.user.id, requestedOrg, seasonYear }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load pit-repair triage. Select a workspace and confirm database access.",
        steps: [
          { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
        ],
        orgId: null,
        seasonYear: seasonYear ?? currentSeasonYear(),
      } satisfies PitRepairTriageView,
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
        case "log-failure": {
          const subsystemName = trimmedOrNull(body.subsystemName, 200);
          const title = trimmedOrNull(body.title, 200);
          if (!subsystemName) throw new Error("subsystemName is required");
          if (!title) throw new Error("title is required");
          await logFailure(client, {
            orgId,
            userId,
            seasonYear,
            subsystemName,
            title,
            symptomNote: trimmedOrEmpty(body.symptomNote, 4000),
            photoUrl: trimmedOrNull(body.photoUrl, 2000),
            minutesUntilNextMatch: nonNegativeInt(body.minutesUntilNextMatch),
            relatedFmeaFailureId: trimmedOrNull(body.relatedFmeaFailureId, 64),
            matchedInventoryItemId: trimmedOrNull(body.matchedInventoryItemId, 64),
          });
          break;
        }
        case "update-status": {
          const reportId = trimmedOrNull(body.reportId, 64);
          if (!reportId) throw new Error("reportId is required");
          const status = oneOf<TriageStatus>(TRIAGE_STATUSES, body.status);
          if (!status) throw new Error("status must be one of open, staged, resolved");
          await updateReportStatus(client, { orgId, reportId, status });
          break;
        }
        case "delete-report": {
          const reportId = trimmedOrNull(body.reportId, 64);
          if (!reportId) throw new Error("reportId is required");
          await deleteReport(client, { orgId, reportId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computePitRepairTriageView(client, { userId, requestedOrg: orgId, seasonYear });
    });

    return Response.json(view);
  } catch (error) {
    return failMeteredAi(error, "Pit-repair triage request failed");
  }
}
