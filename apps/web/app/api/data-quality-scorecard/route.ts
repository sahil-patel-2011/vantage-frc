import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  computeDataQualityScorecardView,
  currentSeasonYear,
  deleteCheck,
  logCheck,
  type DataQualityScorecardView,
} from "../../../lib/data-quality-scorecard/compute-data-quality-scorecard";

export type { DataQualityScorecardView };

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function isoDateOrNull(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function nonNegativeInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

function boolOrFalse(value: unknown): boolean {
  return value === true;
}

function boolOrNull(value: unknown): boolean | null {
  if (value === true) return true;
  if (value === false) return false;
  return null;
}

function unitScoreOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : null;
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
      computeDataQualityScorecardView(client, { userId: session.user.id, requestedOrg, seasonYear }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load the Data Quality Scorecard. Choose your team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
        seasonYear: seasonYear ?? currentSeasonYear(),
      } satisfies DataQualityScorecardView,
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
        case "log-check": {
          const eventKey = trimmedOrNull(body.eventKey, 64);
          const scoutName = trimmedOrNull(body.scoutName, 120);
          const checkDate = isoDateOrNull(body.checkDate);
          if (!eventKey) throw new Error("eventKey is required");
          if (!scoutName) throw new Error("scoutName is required");
          if (!checkDate) throw new Error("checkDate (YYYY-MM-DD) is required");
          await logCheck(client, {
            orgId,
            userId,
            eventKey,
            matchKey: trimmedOrNull(body.matchKey, 40),
            scoutName,
            checkDate,
            expectedDataPoints: nonNegativeInt(body.expectedDataPoints),
            capturedDataPoints: nonNegativeInt(body.capturedDataPoints),
            crossChecked: boolOrFalse(body.crossChecked),
            agreement: boolOrNull(body.agreement),
            deviationScore: unitScoreOrNull(body.deviationScore),
            seasonYear,
            notes: trimmedOrNull(body.notes, 2000),
          });
          break;
        }
        case "delete-check": {
          const checkId = trimmedOrNull(body.checkId, 64);
          if (!checkId) throw new Error("checkId is required");
          await deleteCheck(client, { orgId, checkId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeDataQualityScorecardView(client, { userId, requestedOrg: orgId, seasonYear });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Data Quality Scorecard request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
