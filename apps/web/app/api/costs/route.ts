import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  COST_CATEGORIES,
  COST_STATUSES,
  SUBSCRIPTION_CADENCES,
  addCost,
  addSubscription,
  computeCostsView,
  currentSeasonYear,
  deleteCost,
  deleteSubscription,
  setBudget,
  updateCost,
  updateSubscription,
  type CostsView,
} from "../../../lib/costs/compute-costs";
import type { CostCategory, CostStatus, SubscriptionCadence } from "../../../lib/costs/types";

export type { CostsView };

function oneOf<T extends string>(allowed: T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : null;
}

function isoDateOrNull(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function trimmedOrNull(value: unknown, max = 4000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function moneyOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
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
      computeCostsView(client, { userId: session.user.id, requestedOrg, seasonYear }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load season costs. Select a workspace and confirm database access.",
        steps: [
          { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
        ],
        orgId: null,
        seasonYear: seasonYear ?? currentSeasonYear(),
      } satisfies CostsView,
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
        case "set-budget": {
          await setBudget(client, {
            orgId,
            userId,
            seasonYear,
            totalBudgetUsd: moneyOrNull(body.totalBudgetUsd),
            aiAssistEnabled: body.aiAssistEnabled === true,
            notes: trimmedOrNull(body.notes),
          });
          break;
        }
        case "add-cost": {
          const label = trimmedOrNull(body.label, 200);
          const incurredOn = isoDateOrNull(body.incurredOn);
          if (!label) throw new Error("label is required");
          if (!incurredOn) throw new Error("incurredOn (YYYY-MM-DD) is required");
          await addCost(client, {
            orgId,
            userId,
            seasonYear,
            label,
            category: oneOf<CostCategory>(COST_CATEGORIES, body.category) ?? "other",
            amountUsd: moneyOrNull(body.amountUsd) ?? 0,
            vendor: trimmedOrNull(body.vendor, 200),
            incurredOn,
            status: oneOf<CostStatus>(COST_STATUSES, body.status) ?? "planned",
            notes: trimmedOrNull(body.notes),
          });
          break;
        }
        case "update-cost": {
          const costId = trimmedOrNull(body.costId, 64);
          if (!costId) throw new Error("costId is required");
          const category = body.category === undefined ? undefined : oneOf<CostCategory>(COST_CATEGORIES, body.category);
          if (body.category !== undefined && !category) throw new Error("Invalid category");
          const status = body.status === undefined ? undefined : oneOf<CostStatus>(COST_STATUSES, body.status);
          if (body.status !== undefined && !status) throw new Error("Invalid status");
          await updateCost(client, {
            orgId,
            costId,
            label: body.label === undefined ? undefined : (trimmedOrNull(body.label, 200) ?? undefined),
            category: category ?? undefined,
            amountUsd: body.amountUsd === undefined ? undefined : (moneyOrNull(body.amountUsd) ?? undefined),
            vendor: body.vendor === undefined ? undefined : trimmedOrNull(body.vendor, 200),
            incurredOn: body.incurredOn === undefined ? undefined : (isoDateOrNull(body.incurredOn) ?? undefined),
            status: status ?? undefined,
            notes: body.notes === undefined ? undefined : trimmedOrNull(body.notes),
          });
          break;
        }
        case "delete-cost": {
          const costId = trimmedOrNull(body.costId, 64);
          if (!costId) throw new Error("costId is required");
          await deleteCost(client, { orgId, costId });
          break;
        }
        case "add-subscription": {
          const name = trimmedOrNull(body.name, 200);
          if (!name) throw new Error("name is required");
          await addSubscription(client, {
            orgId,
            userId,
            seasonYear,
            name,
            provider: trimmedOrNull(body.provider, 200),
            amountUsd: moneyOrNull(body.amountUsd) ?? 0,
            cadence: oneOf<SubscriptionCadence>(SUBSCRIPTION_CADENCES, body.cadence) ?? "monthly",
            active: body.active !== false,
            notes: trimmedOrNull(body.notes),
          });
          break;
        }
        case "update-subscription": {
          const subscriptionId = trimmedOrNull(body.subscriptionId, 64);
          if (!subscriptionId) throw new Error("subscriptionId is required");
          const cadence = body.cadence === undefined ? undefined : oneOf<SubscriptionCadence>(SUBSCRIPTION_CADENCES, body.cadence);
          if (body.cadence !== undefined && !cadence) throw new Error("Invalid cadence");
          await updateSubscription(client, {
            orgId,
            subscriptionId,
            name: body.name === undefined ? undefined : (trimmedOrNull(body.name, 200) ?? undefined),
            provider: body.provider === undefined ? undefined : trimmedOrNull(body.provider, 200),
            amountUsd: body.amountUsd === undefined ? undefined : (moneyOrNull(body.amountUsd) ?? undefined),
            cadence: cadence ?? undefined,
            active: body.active === undefined ? undefined : body.active === true,
            notes: body.notes === undefined ? undefined : trimmedOrNull(body.notes),
          });
          break;
        }
        case "delete-subscription": {
          const subscriptionId = trimmedOrNull(body.subscriptionId, 64);
          if (!subscriptionId) throw new Error("subscriptionId is required");
          await deleteSubscription(client, { orgId, subscriptionId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeCostsView(client, { userId, requestedOrg: orgId, seasonYear });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Season costs request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
