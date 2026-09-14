import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  CONSUMABLE_CATEGORIES,
  adjustStock,
  computeSparesView,
  createConsumable,
  deleteConsumable,
  updateConsumable,
  type SparesView,
} from "../../../lib/spares/compute-spares";
import type { ConsumableCategory } from "../../../lib/spares/types";

export type { SparesView };

function oneOf<T extends string>(allowed: T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : null;
}

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function qtyOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

function deltaFrom(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const requestedOrg = new URL(request.url).searchParams.get("orgId");

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeSparesView(client, { userId: session.user.id, requestedOrg }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load consumables. Choose your team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
      } satisfies SparesView,
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
        case "create-item": {
          const name = trimmedOrNull(body.name, 200);
          if (!name) throw new Error("name is required");
          await createConsumable(client, {
            orgId,
            userId,
            name,
            category: oneOf<ConsumableCategory>(CONSUMABLE_CATEGORIES, body.category) ?? "other",
            unit: trimmedOrNull(body.unit, 30) ?? "each",
            onHand: qtyOrNull(body.onHand) ?? 0,
            reorderPoint: qtyOrNull(body.reorderPoint) ?? 0,
            preferredVendor: trimmedOrNull(body.preferredVendor, 200),
            notes: trimmedOrNull(body.notes),
            isSpare: Boolean(body.isSpare),
          });
          break;
        }
        case "update-item": {
          const itemId = trimmedOrNull(body.itemId, 64);
          if (!itemId) throw new Error("itemId is required");
          const category = body.category === undefined ? undefined : oneOf<ConsumableCategory>(CONSUMABLE_CATEGORIES, body.category);
          if (body.category !== undefined && !category) throw new Error("Invalid category");
          await updateConsumable(client, {
            orgId,
            userId,
            itemId,
            name: body.name === undefined ? undefined : (trimmedOrNull(body.name, 200) ?? undefined),
            category: category ?? undefined,
            unit: body.unit === undefined ? undefined : (trimmedOrNull(body.unit, 30) ?? undefined),
            onHand: body.onHand === undefined ? undefined : (qtyOrNull(body.onHand) ?? undefined),
            reorderPoint: body.reorderPoint === undefined ? undefined : (qtyOrNull(body.reorderPoint) ?? undefined),
            preferredVendor: body.preferredVendor === undefined ? undefined : trimmedOrNull(body.preferredVendor, 200),
            notes: body.notes === undefined ? undefined : trimmedOrNull(body.notes),
            isSpare: body.isSpare === undefined ? undefined : Boolean(body.isSpare),
          });
          break;
        }
        case "adjust-stock": {
          const itemId = trimmedOrNull(body.itemId, 64);
          if (!itemId) throw new Error("itemId is required");
          await adjustStock(client, { orgId, userId, itemId, delta: deltaFrom(body.delta) });
          break;
        }
        case "delete-item": {
          const itemId = trimmedOrNull(body.itemId, 64);
          if (!itemId) throw new Error("itemId is required");
          await deleteConsumable(client, { orgId, itemId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeSparesView(client, { userId, requestedOrg: orgId });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Consumables request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
