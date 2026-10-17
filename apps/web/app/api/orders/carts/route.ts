// Vendor carts (0738). GET: approved requests grouped one cart per vendor, plus this
// season's placed orders. POST: check out a cart, or receive everything on a placed order.
// Money writes are finance-manager only.
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { FINANCE_MANAGER_REQUIRED, isFinanceAccessDenied } from "../../../../lib/finance/finance-managers";
import { sanitizeFinanceWriteBody } from "../../../../lib/finance/sanitize-write";
import { parseUsd } from "../../../../lib/orders/vendor-carts-model";
import {
  computeVendorCartsView,
  placeVendorOrder,
  receiveVendorOrder,
} from "../../../../lib/orders/vendor-orders";
import { publicErrorMessage } from "../../../../lib/security/public-error";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidOrNull(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value.trim()) ? value.trim().toLowerCase() : null;
}

function textOrNull(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function money(value: unknown, what: string, fallback: number | null): number {
  const parsed = parseUsd(value);
  if (parsed === "invalid") throw new Error(`${what} must be a dollar amount from 0 to 1,000,000.`);
  if (parsed === null) {
    if (fallback === null) throw new Error(`Enter ${what.toLowerCase()}.`);
    return fallback;
  }
  return parsed;
}

function seasonOf(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1992 && n <= 2100 ? n : undefined;
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Your session ended. Sign in again." }, { status: 401 });
  const params = new URL(request.url).searchParams;
  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeVendorCartsView(client, { userId: session.user.id, requestedOrg: uuidOrNull(params.get("orgId")), seasonYear: seasonOf(params.get("season")) }),
    );
    return Response.json(view, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: publicErrorMessage(error, "Couldn't load the carts.") }, { status: 400 });
  }
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Your session ended. Sign in again." }, { status: 401 });
  let body: Record<string, unknown>;
  try {
    body = sanitizeFinanceWriteBody((await request.json()) as Record<string, unknown>);
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const orgId = uuidOrNull(body.orgId);
  if (!orgId) return Response.json({ error: "Choose your team first." }, { status: 400 });
  const userId = session.user.id;
  const seasonYear = seasonOf(body.seasonYear);

  try {
    const view = await withRls({ userId, orgId }, async (client) => {
      switch (body.action) {
        case "place-order": {
          const rawLines = Array.isArray(body.lines) ? body.lines : [];
          const lines = rawLines.map((line) => {
            const row = (line ?? {}) as Record<string, unknown>;
            const orderId = uuidOrNull(row.orderId);
            if (!orderId) throw new Error("A cart line is missing its request.");
            return { orderId, paidUsd: money(row.paidUsd, "What each item cost", null) };
          });
          await placeVendorOrder(client, {
            orgId,
            userId,
            lines,
            shippingUsd: money(body.shippingUsd, "Shipping", 0),
            taxUsd: money(body.taxUsd, "Tax", 0),
            orderNumber: textOrNull(body.orderNumber, 120),
            notes: textOrNull(body.notes, 2000),
          });
          break;
        }
        case "receive-order": {
          const vendorOrderId = uuidOrNull(body.vendorOrderId);
          if (!vendorOrderId) throw new Error("Pick an order.");
          await receiveVendorOrder(client, { orgId, userId, vendorOrderId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }
      return computeVendorCartsView(client, { userId, requestedOrg: orgId, seasonYear });
    });
    return Response.json(view);
  } catch (error) {
    if (isFinanceAccessDenied(error)) {
      return Response.json({ error: FINANCE_MANAGER_REQUIRED, reason: "not_finance_manager" }, { status: 403 });
    }
    return Response.json({ error: publicErrorMessage(error, "That didn't go through. Try again.") }, { status: 400 });
  }
}
