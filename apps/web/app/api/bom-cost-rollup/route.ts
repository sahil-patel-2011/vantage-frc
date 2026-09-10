import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  addLineItem,
  computeBomCostRollupView,
  currentSeasonYear,
  deleteLineItem,
  setBudget,
  type BomCostRollupView,
} from "../../../lib/bom-cost-rollup/compute-bom-cost-rollup";
import type { BomCategory, BomSource } from "../../../lib/bom-cost-rollup/types";

export type { BomCostRollupView };

const CATEGORIES: BomCategory[] = ["purchased", "raw_material", "fastener", "electronics", "other"];
const SOURCES: BomSource[] = ["manual", "cad_import"];

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function seasonFrom(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 2000 && n < 3000 ? Math.round(n) : currentSeasonYear();
}

function categoryFrom(value: unknown): BomCategory {
  return typeof value === "string" && (CATEGORIES as string[]).includes(value)
    ? (value as BomCategory)
    : "purchased";
}

function sourceFrom(value: unknown): BomSource {
  return typeof value === "string" && (SOURCES as string[]).includes(value)
    ? (value as BomSource)
    : "manual";
}

function nonNegativeNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");
  const seasonParam = url.searchParams.get("seasonYear");
  const seasonYear = seasonParam ? seasonFrom(seasonParam) : null;

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeBomCostRollupView(client, { userId: session.user.id, requestedOrg, seasonYear }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load the BOM cost rollup. Choose your team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
        seasonYear: currentSeasonYear(),
      } satisfies BomCostRollupView,
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
        case "add-item": {
          const partName = trimmedOrNull(body.partName, 200);
          if (!partName) throw new Error("partName is required");
          await addLineItem(client, {
            orgId,
            userId,
            partName,
            subsystem: trimmedOrNull(body.subsystem, 120) ?? "Unassigned",
            category: categoryFrom(body.category),
            quantity: Math.max(1, Math.round(nonNegativeNumber(body.quantity) || 1)),
            unitCostUsd: nonNegativeNumber(body.unitCostUsd),
            source: sourceFrom(body.source),
            cadReference: trimmedOrNull(body.cadReference, 300),
            notes: trimmedOrNull(body.notes, 500),
            seasonYear,
          });
          break;
        }
        case "delete-item": {
          const itemId = trimmedOrNull(body.itemId, 64);
          if (!itemId) throw new Error("itemId is required");
          await deleteLineItem(client, { orgId, itemId });
          break;
        }
        case "set-budget": {
          await setBudget(client, { orgId, userId, seasonYear, budgetUsd: nonNegativeNumber(body.budgetUsd) });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeBomCostRollupView(client, { userId, requestedOrg: orgId, seasonYear });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "BOM cost rollup request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
