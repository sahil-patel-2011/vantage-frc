import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { sanitizeFinanceWriteBody } from "../../../lib/finance/sanitize-write";
import {
  assignBuyer,
  computeOrdersView,
  progressOrder,
  reviewOrder,
  submitOrder,
  updateOrderItemUrl,
  type OrdersView,
} from "../../../lib/orders/compute-orders";

export type { OrdersView };

function uuidOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)
    ? trimmed
    : null;
}

function trimmedOrNull(value: unknown, max = 4000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");
  const focusOrderId = url.searchParams.get("orderId");
  const seasonParam = url.searchParams.get("season");
  const seasonYear = seasonParam ? Number(seasonParam) : undefined;

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeOrdersView(client, {
        userId: session.user.id,
        requestedOrg,
        focusOrderId,
        seasonYear: Number.isFinite(seasonYear) ? seasonYear : undefined,
      }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load purchase requests. Choose your team and confirm database access.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: null,
      } satisfies OrdersView,
      { status: 200 },
    );
  }
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = sanitizeFinanceWriteBody((await request.json()) as Record<string, unknown>);
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const orgId = uuidOrNull(body.orgId) ?? trimmedOrNull(body.orgId, 64);
  const action = typeof body.action === "string" ? body.action : "";
  if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });

  const userId = session.user.id;
  const seasonYear = body.seasonYear === undefined ? undefined : Number(body.seasonYear);

  try {
    const view = await withRls({ userId, orgId }, async (client) => {
      switch (action) {
        case "submit-order": {
          await submitOrder(client, {
            orgId,
            userId,
            seasonYear: Number.isFinite(seasonYear) ? seasonYear : undefined,
            body,
          });
          break;
        }
        case "approve-order": {
          const orderId = uuidOrNull(body.orderId) ?? trimmedOrNull(body.orderId, 64);
          if (!orderId) throw new Error("orderId is required");
          const buyerUserId =
            body.buyerUserId === undefined || body.buyerUserId === null || body.buyerUserId === ""
              ? null
              : uuidOrNull(body.buyerUserId);
          if (body.buyerUserId !== undefined && body.buyerUserId !== null && body.buyerUserId !== "" && !buyerUserId) {
            throw new Error("Invalid buyer");
          }
          await reviewOrder(client, {
            orgId,
            userId,
            orderId,
            decision: "approved",
            reviewNotes: body.reviewNotes === undefined ? null : trimmedOrNull(body.reviewNotes, 1000),
            buyerUserId,
          });
          break;
        }
        case "reject-order": {
          const orderId = uuidOrNull(body.orderId) ?? trimmedOrNull(body.orderId, 64);
          if (!orderId) throw new Error("orderId is required");
          await reviewOrder(client, {
            orgId,
            userId,
            orderId,
            decision: "rejected",
            reviewNotes: body.reviewNotes === undefined ? null : trimmedOrNull(body.reviewNotes, 1000),
          });
          break;
        }
        case "assign-buyer": {
          const orderId = uuidOrNull(body.orderId) ?? trimmedOrNull(body.orderId, 64);
          const buyerUserId = uuidOrNull(body.buyerUserId);
          if (!orderId || !buyerUserId) throw new Error("orderId and buyerUserId are required");
          await assignBuyer(client, { orgId, userId, orderId, buyerUserId });
          break;
        }
        case "update-item-url": {
          const orderId = uuidOrNull(body.orderId) ?? trimmedOrNull(body.orderId, 64);
          const itemUrl = trimmedOrNull(body.itemUrl, 2000);
          if (!orderId || !itemUrl) throw new Error("orderId and itemUrl are required");
          await updateOrderItemUrl(client, { orgId, userId, orderId, itemUrl });
          break;
        }
        case "mark-ordered": {
          const orderId = uuidOrNull(body.orderId) ?? trimmedOrNull(body.orderId, 64);
          if (!orderId) throw new Error("orderId is required");
          await progressOrder(client, { orgId, userId, orderId, status: "ordered" });
          break;
        }
        case "mark-received": {
          const orderId = uuidOrNull(body.orderId) ?? trimmedOrNull(body.orderId, 64);
          if (!orderId) throw new Error("orderId is required");
          await progressOrder(client, { orgId, userId, orderId, status: "received" });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeOrdersView(client, {
        userId,
        requestedOrg: orgId,
        focusOrderId: typeof body.orderId === "string" ? body.orderId : null,
        seasonYear: Number.isFinite(seasonYear) ? seasonYear : undefined,
      });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Purchase request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
