import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  addReorder,
  addVendor,
  computeVendorLeadTimesView,
  deleteReorder,
  deleteVendor,
  setReorderStatus,
  type VendorLeadTimesView,
} from "../../../lib/vendor-lead-times/compute-vendor-lead-times";
import type { ReorderStatus } from "../../../lib/vendor-lead-times/types";

export type { VendorLeadTimesView };

const REORDER_STATUSES: ReorderStatus[] = ["open", "ordered", "received", "cancelled"];

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

function nonNegativeInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeVendorLeadTimesView(client, { userId: session.user.id, requestedOrg }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load vendor lead times. Choose your team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
      } satisfies VendorLeadTimesView,
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
        case "add-vendor": {
          const name = trimmedOrNull(body.name, 200);
          if (!name) throw new Error("name is required");
          await addVendor(client, {
            orgId,
            userId,
            name,
            leadTimeDays: nonNegativeInt(body.leadTimeDays),
            safetyBufferDays: nonNegativeInt(body.safetyBufferDays),
            notes: trimmedOrNull(body.notes, 2000),
          });
          break;
        }
        case "delete-vendor": {
          const vendorId = trimmedOrNull(body.vendorId, 64);
          if (!vendorId) throw new Error("vendorId is required");
          await deleteVendor(client, { orgId, vendorId });
          break;
        }
        case "add-reorder": {
          const vendorId = trimmedOrNull(body.vendorId, 64);
          const itemName = trimmedOrNull(body.itemName, 200);
          const neededBy = isoDateOrNull(body.neededBy);
          if (!vendorId) throw new Error("vendorId is required");
          if (!itemName) throw new Error("itemName is required");
          if (!neededBy) throw new Error("neededBy (YYYY-MM-DD) is required");
          await addReorder(client, {
            orgId,
            userId,
            vendorId,
            itemName,
            quantity: nonNegativeInt(body.quantity) || 1,
            neededBy,
            notes: trimmedOrNull(body.notes, 2000),
          });
          break;
        }
        case "set-reorder-status": {
          const reorderId = trimmedOrNull(body.reorderId, 64);
          const status = oneOf<ReorderStatus>(REORDER_STATUSES, body.status);
          if (!reorderId) throw new Error("reorderId is required");
          if (!status) throw new Error("status is invalid");
          await setReorderStatus(client, { orgId, reorderId, status });
          break;
        }
        case "delete-reorder": {
          const reorderId = trimmedOrNull(body.reorderId, 64);
          if (!reorderId) throw new Error("reorderId is required");
          await deleteReorder(client, { orgId, reorderId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeVendorLeadTimesView(client, { userId, requestedOrg: orgId });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Vendor lead times request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
