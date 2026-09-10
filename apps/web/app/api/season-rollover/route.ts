import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { SEASON_ROLLOVER_CATEGORIES, currentSeasonYear, nextSeasonYear } from "../../../lib/season-rollover";
import {
  addItem,
  completePlan,
  computeSeasonRolloverView,
  createPlan,
  deleteItem,
  deletePlan,
  setItemCarried,
  type SeasonRolloverView,
} from "../../../lib/season-rollover/compute-season-rollover";
import type { SeasonRolloverCategory } from "../../../lib/season-rollover/types";

export type { SeasonRolloverView };

function oneOf<T extends string>(allowed: T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : null;
}

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function seasonFrom(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 2000 && n < 3000 ? Math.round(n) : fallback;
}

function boolFrom(value: unknown): boolean {
  return value === true || value === "true";
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");
  const seasonParam = url.searchParams.get("toSeasonYear");
  const toSeasonYear = seasonParam ? seasonFrom(seasonParam, nextSeasonYear(currentSeasonYear())) : null;

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeSeasonRolloverView(client, { userId: session.user.id, requestedOrg, toSeasonYear }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load Season Rollover. Choose your team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
        toSeasonYear: toSeasonYear ?? nextSeasonYear(currentSeasonYear()),
      } satisfies SeasonRolloverView,
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
  const toSeasonYear = seasonFrom(body.toSeasonYear, nextSeasonYear(currentSeasonYear()));

  try {
    const view = await withRls({ userId, orgId }, async (client) => {
      const member = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2`, [
        orgId,
        userId,
      ]);
      if (!member.rowCount) throw new Error("forbidden");

      switch (action) {
        case "create-plan": {
          const fromSeasonYear = seasonFrom(body.fromSeasonYear, currentSeasonYear());
          const toYear = seasonFrom(body.toSeasonYear, nextSeasonYear(fromSeasonYear));
          if (toYear <= fromSeasonYear) throw new Error("toSeasonYear must be after fromSeasonYear");
          await createPlan(client, {
            orgId,
            userId,
            fromSeasonYear,
            toSeasonYear: toYear,
            notes: trimmedOrNull(body.notes, 2000),
          });
          break;
        }
        case "add-item": {
          const planId = trimmedOrNull(body.planId, 64);
          const label = trimmedOrNull(body.label, 200);
          if (!planId) throw new Error("planId is required");
          if (!label) throw new Error("label is required");
          const category =
            oneOf<SeasonRolloverCategory>(SEASON_ROLLOVER_CATEGORIES, body.category) ?? "other";
          await addItem(client, {
            orgId,
            userId,
            planId,
            category,
            label,
            notes: trimmedOrNull(body.notes, 2000),
          });
          break;
        }
        case "set-item-carried": {
          const itemId = trimmedOrNull(body.itemId, 64);
          if (!itemId) throw new Error("itemId is required");
          await setItemCarried(client, { orgId, itemId, carried: boolFrom(body.carried) });
          break;
        }
        case "delete-item": {
          const itemId = trimmedOrNull(body.itemId, 64);
          if (!itemId) throw new Error("itemId is required");
          await deleteItem(client, { orgId, itemId });
          break;
        }
        case "complete-plan": {
          const planId = trimmedOrNull(body.planId, 64);
          if (!planId) throw new Error("planId is required");
          await completePlan(client, { orgId, planId });
          break;
        }
        case "delete-plan": {
          const planId = trimmedOrNull(body.planId, 64);
          if (!planId) throw new Error("planId is required");
          await deletePlan(client, { orgId, planId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeSeasonRolloverView(client, { userId, requestedOrg: orgId, toSeasonYear });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Season Rollover request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
