/**
 * /api/part-requests — a student asks, a mentor decides.
 *
 * Submitting reuses `submitOrder` and deciding reuses `reviewOrder` from
 * lib/orders/compute-orders.ts, so the money side of an approval (the ledger
 * mirror that /budget subtracts from the season budget) is the SAME code path
 * the treasurer console has always used. Nothing about dollars is duplicated.
 *
 * WHO CAN DECIDE: owners and admins. `reviewOrder` asserts that itself, and
 * `purchase_requests_admin_write` (0035) enforces it in RLS. A person holding
 * only the 0620 `manage_budget` capability can see and set the budget but cannot
 * approve a request — the route says so in those words rather than letting them
 * press a button that fails.
 *
 * org_id comes from `resolveMembership`, never from the body.
 */

import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { CapabilityError, resolveMembership } from "../../../lib/capabilities/org-capabilities";
import { computePartRequestsView } from "../../../lib/part-requests/compute-part-requests";
import { currentSeasonYear } from "../../../lib/budget/compute-budget";
import { progressOrder, reviewOrder, submitOrder } from "../../../lib/orders/compute-orders";

const DECIDE_DENIED =
  "Approving a part request is limited to the team Owner and Admins. Budget access alone " +
  "does not include it — ask an owner to make you an admin if you should be deciding these.";

function seasonFrom(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 2000 && n < 3000 ? Math.round(n) : currentSeasonYear();
}

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function fail(error: unknown): Response {
  if (error instanceof CapabilityError) {
    return Response.json({ error: error.message, reason: error.reason }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "Part request failed";
  if (/row-level security/i.test(message)) {
    return Response.json({ error: DECIDE_DENIED, reason: "not_allowed" }, { status: 403 });
  }
  if (/administrator access required/i.test(message)) {
    return Response.json({ error: DECIDE_DENIED, reason: "not_allowed" }, { status: 403 });
  }
  // The 0622 trigger's own words, if a write somehow reaches it.
  if (/can (decide|record) a purchase[- ]request/i.test(message)) {
    return Response.json({ error: DECIDE_DENIED, reason: "not_allowed" }, { status: 403 });
  }
  return Response.json({ error: message }, { status: 400 });
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");
  const seasonYear = seasonFrom(url.searchParams.get("season"));

  try {
    const view = await withRls({ userId: session.user.id }, async (client) => {
      const membership = await resolveMembership(client, session.user.id, requestedOrg);
      const leadership = membership.role === "owner" || membership.role === "admin";
      return computePartRequestsView(client, {
        orgId: membership.orgId,
        orgName: membership.orgName,
        userId: session.user.id,
        canDecide: leadership,
        seasonYear,
      });
    });
    return Response.json(view);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId") ?? trimmedOrNull(body.orgId, 64);
  const action = typeof body.action === "string" ? body.action : "";
  const seasonYear = seasonFrom(body.seasonYear);

  try {
    const view = await withRls({ userId: session.user.id }, async (client) => {
      const membership = await resolveMembership(client, session.user.id, requestedOrg);
      const orgId = membership.orgId;
      const userId = session.user.id;
      const leadership = membership.role === "owner" || membership.role === "admin";

      const requireLeadership = () => {
        if (!leadership) throw new CapabilityError(403, DECIDE_DENIED, "not_allowed");
      };

      switch (action) {
        case "submit": {
          // Any member may ask. The row is theirs: purchase_requests_member_insert
          // requires requested_by = current_app_user_id(), so `requestedBy` can
          // never be forged onto someone else.
          await submitOrder(client, { orgId, userId, seasonYear, body });
          break;
        }

        case "approve":
        case "reject": {
          requireLeadership();
          const requestId = trimmedOrNull(body.requestId, 64);
          if (!requestId) throw new Error("Which request are you deciding?");
          await reviewOrder(client, {
            orgId,
            userId,
            orderId: requestId,
            decision: action === "approve" ? "approved" : "rejected",
            reviewNotes: trimmedOrNull(body.reviewNotes, 1000),
          });
          break;
        }

        case "mark-ordered": {
          const requestId = trimmedOrNull(body.requestId, 64);
          if (!requestId) throw new Error("Which request was ordered?");
          // progressOrder allows the assigned buyer or the requester too — the
          // money was already committed at approval, so this is a status move.
          await progressOrder(client, { orgId, userId, orderId: requestId, status: "ordered" });
          break;
        }

        default:
          throw new Error("Unknown part request action");
      }

      return computePartRequestsView(client, {
        orgId,
        orgName: membership.orgName,
        userId,
        canDecide: leadership,
        seasonYear,
      });
    });

    return Response.json(view);
  } catch (error) {
    return fail(error);
  }
}
