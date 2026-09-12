import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { failMeteredAi } from "../../../lib/metered-ai-fail";
import {
  computeWiringDiagnoserView,
  currentSeasonYear,
  deleteCheck,
  logCheck,
  parseExpectedCircuits,
  parseObservedCircuits,
  type WiringDiagnoserView,
} from "../../../lib/wiring-diagnoser/compute-wiring-diagnoser";

export type { WiringDiagnoserView };

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
      computeWiringDiagnoserView(client, { userId: session.user.id, requestedOrg, seasonYear }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load Wiring check. Choose your team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
        seasonYear: seasonYear ?? currentSeasonYear(),
      } satisfies WiringDiagnoserView,
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
          const boardName = trimmedOrNull(body.boardName, 200);
          if (!boardName) throw new Error("boardName is required");
          const expectedCircuits = parseExpectedCircuits(body.expectedCircuits);
          const observedCircuits = parseObservedCircuits(body.observedCircuits);
          if (expectedCircuits.length === 0) {
            throw new Error("At least one expected circuit (from the wiring diagram) is required");
          }
          await logCheck(client, {
            orgId,
            userId,
            seasonYear,
            boardName,
            photoUrl: trimmedOrNull(body.photoUrl, 2000),
            expectedCircuits,
            observedCircuits,
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

      return computeWiringDiagnoserView(client, { userId, requestedOrg: orgId, seasonYear });
    });

    return Response.json(view);
  } catch (error) {
    return failMeteredAi(error, "Wiring check request failed");
  }
}
