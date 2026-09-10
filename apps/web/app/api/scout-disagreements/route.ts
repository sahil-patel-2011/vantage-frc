import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { isScoutForbidden, scoutForbiddenResponse } from "../../../lib/scout-org-access";
import { headers } from "next/headers";
import {
  computeScoutDisagreementsView,
  currentSeasonYear,
  dismissDisagreement,
  logDisagreement,
  reopenDisagreement,
  resolveDisagreement,
  type ScoutDisagreementsView,
} from "../../../lib/scout-disagreements/compute-scout-disagreements";
import type { ScoutDisagreementValue } from "../../../lib/scout-disagreements/types";

export type { ScoutDisagreementsView };

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function positiveInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

function seasonFrom(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 2000 && n < 3000 ? Math.round(n) : currentSeasonYear();
}

function valuesFrom(value: unknown): ScoutDisagreementValue[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
    .map((entry) => ({
      source: trimmedOrNull(entry.source, 120) ?? "Unknown scout",
      value: trimmedOrNull(entry.value, 500) ?? "",
    }))
    .filter((entry) => entry.value.length > 0)
    .slice(0, 20);
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
      computeScoutDisagreementsView(client, { userId: session.user.id, requestedOrg, seasonYear }),
    );
    return Response.json(view);
  } catch (error) {
    if (isScoutForbidden(error)) return scoutForbiddenResponse();
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load Scout Disagreements. Select a team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
        seasonYear: seasonYear ?? currentSeasonYear(),
      } satisfies ScoutDisagreementsView,
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
        case "log-disagreement": {
          const matchNumber = positiveInt(body.matchNumber);
          const teamNumber = positiveInt(body.teamNumber);
          const fieldKey = trimmedOrNull(body.fieldKey, 120);
          const fieldLabel = trimmedOrNull(body.fieldLabel, 200);
          const values = valuesFrom(body.values);
          if (!matchNumber) throw new Error("matchNumber is required");
          if (!teamNumber) throw new Error("teamNumber is required");
          if (!fieldKey) throw new Error("fieldKey is required");
          if (!fieldLabel) throw new Error("fieldLabel is required");
          if (values.length < 2) throw new Error("At least two conflicting values are required");
          await logDisagreement(client, {
            orgId,
            userId,
            seasonYear,
            eventKey: trimmedOrNull(body.eventKey, 60),
            matchNumber,
            teamNumber,
            fieldKey,
            fieldLabel,
            values,
          });
          break;
        }
        case "resolve": {
          const disagreementId = trimmedOrNull(body.disagreementId, 64);
          const resolvedValue = trimmedOrNull(body.resolvedValue, 500);
          if (!disagreementId) throw new Error("disagreementId is required");
          if (!resolvedValue) throw new Error("resolvedValue is required");
          await resolveDisagreement(client, {
            orgId,
            userId,
            disagreementId,
            resolvedValue,
            note: trimmedOrNull(body.note, 2000),
          });
          break;
        }
        case "dismiss": {
          const disagreementId = trimmedOrNull(body.disagreementId, 64);
          if (!disagreementId) throw new Error("disagreementId is required");
          await dismissDisagreement(client, {
            orgId,
            userId,
            disagreementId,
            note: trimmedOrNull(body.note, 2000),
          });
          break;
        }
        case "reopen": {
          const disagreementId = trimmedOrNull(body.disagreementId, 64);
          if (!disagreementId) throw new Error("disagreementId is required");
          await reopenDisagreement(client, {
            orgId,
            userId,
            disagreementId,
            note: trimmedOrNull(body.note, 2000),
          });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeScoutDisagreementsView(client, { userId, requestedOrg: orgId, seasonYear });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scout Disagreements request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
