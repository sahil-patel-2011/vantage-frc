import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  addScout,
  computeShiftBalancerView,
  deletePlan,
  generatePlan,
  removeScout,
  setScoutActive,
  type ShiftBalancerView,
} from "../../../lib/shift-balancer/compute-shift-balancer";
import { DEFAULT_STATIONS } from "../../../lib/shift-balancer";

export type { ShiftBalancerView };

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function positiveInt(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
}

function stationsFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return DEFAULT_STATIONS;
  const stations = value
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => v.trim().slice(0, 40))
    .slice(0, 12);
  return stations.length > 0 ? stations : DEFAULT_STATIONS;
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeShiftBalancerView(client, { userId: session.user.id, requestedOrg }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load the shift balancer. Choose your team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
      } satisfies ShiftBalancerView,
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

  try {
    const view = await withRls({ userId, orgId }, async (client) => {
      const member = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2`, [
        orgId,
        userId,
      ]);
      if (!member.rowCount) throw new Error("forbidden");

      switch (action) {
        case "add-scout": {
          const name = trimmedOrNull(body.name, 120);
          if (!name) throw new Error("name is required");
          await addScout(client, { orgId, userId, name });
          break;
        }
        case "set-scout-active": {
          const scoutId = trimmedOrNull(body.scoutId, 64);
          if (!scoutId) throw new Error("scoutId is required");
          await setScoutActive(client, { orgId, scoutId, active: Boolean(body.active) });
          break;
        }
        case "remove-scout": {
          const scoutId = trimmedOrNull(body.scoutId, 64);
          if (!scoutId) throw new Error("scoutId is required");
          await removeScout(client, { orgId, scoutId });
          break;
        }
        case "generate-plan": {
          const useEventSchedule = body.useEventSchedule === true;
          const label =
            trimmedOrNull(body.label, 200) ?? (useEventSchedule ? "Event quals rotation" : "Shift plan");
          const matchCount = positiveInt(body.matchCount, 10);
          const maxConsecutiveMatches = positiveInt(body.maxConsecutiveMatches, 3);
          const stations = stationsFrom(body.stations);
          await generatePlan(client, {
            orgId,
            userId,
            label,
            matchCount,
            stations,
            maxConsecutiveMatches,
            useEventSchedule,
          });
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

      return computeShiftBalancerView(client, { userId, requestedOrg: orgId });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Shift balancer request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
