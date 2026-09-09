/**
 * /api/budget — the mentor-only season budget.
 *
 * Two layers, both real:
 *  1. RLS. `season_budgets` is behind
 *     `has_org_capability(org_id, 'manage_budget')` since 0621, so a student's
 *     SELECT returns zero rows and their INSERT is refused by the database.
 *     Deleting this file would not open the budget up.
 *  2. This route, which checks the same function FIRST so the answer is a
 *     sentence with a 403 instead of an empty page or a policy violation.
 *
 * org_id NEVER comes from the request body. `resolveMembership` treats the
 * `orgId` query parameter as a filter over the caller's own memberships; an id
 * that is not one of them yields no row and is refused.
 */

import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  CapabilityError,
  canManageBudget,
  grantCapability,
  grantableMembers,
  implicitHolders,
  listCapabilityGrants,
  resolveMembership,
  revokeCapability,
} from "../../../lib/capabilities/org-capabilities";
import {
  computeBudgetView,
  currentSeasonYear,
  setSeasonBudget,
  type BudgetView,
} from "../../../lib/budget/compute-budget";
import { addCost } from "../../../lib/costs/compute-costs";

const BUDGET_DENIED =
  "The season budget is limited to mentors. In Vantage that means the team Owner and Admins, " +
  "plus anyone an owner has explicitly given budget access. There is no separate mentor flag.";

function seasonFrom(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 2000 && n < 3000 ? Math.round(n) : currentSeasonYear();
}

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function moneyOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100_000_000) return null;
  return Math.round(n * 100) / 100;
}

function isoDate(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())
    ? value.trim()
    : null;
}

function fail(error: unknown): Response {
  if (error instanceof CapabilityError) {
    return Response.json({ error: error.message, reason: error.reason }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "Budget request failed";
  // A raw policy violation is not a sentence anyone can act on.
  if (/row-level security/i.test(message)) {
    return Response.json({ error: BUDGET_DENIED, reason: "not_budget_manager" }, { status: 403 });
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
    const payload = await withRls({ userId: session.user.id }, async (client) => {
      const membership = await resolveMembership(client, session.user.id, requestedOrg);
      if (!(await canManageBudget(client, membership.orgId))) {
        throw new CapabilityError(403, BUDGET_DENIED, "not_budget_manager");
      }

      const view = await computeBudgetView(client, {
        orgId: membership.orgId,
        orgName: membership.orgName,
        teamNumber: membership.teamNumber,
        accessVia:
          membership.role === "owner" ? "owner" : membership.role === "admin" ? "admin" : "granted",
        seasonYear,
      });

      // Only leadership can see or change who else holds budget access.
      const leadership = membership.role === "owner" || membership.role === "admin";
      return {
        view,
        canGrantAccess: leadership,
        grants: leadership ? await listCapabilityGrants(client, membership.orgId, "manage_budget") : [],
        implicitHolders: leadership ? await implicitHolders(client, membership.orgId) : [],
        candidates: leadership ? await grantableMembers(client, membership.orgId, "manage_budget") : [],
      };
    });

    return Response.json(payload);
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
    const payload = await withRls({ userId: session.user.id }, async (client) => {
      const membership = await resolveMembership(client, session.user.id, requestedOrg);
      const orgId = membership.orgId;
      const userId = session.user.id;

      if (!(await canManageBudget(client, orgId))) {
        throw new CapabilityError(403, BUDGET_DENIED, "not_budget_manager");
      }

      switch (action) {
        case "set-budget": {
          const totalBudgetUsd = body.totalBudgetUsd === null ? null : moneyOrNull(body.totalBudgetUsd);
          if (body.totalBudgetUsd != null && body.totalBudgetUsd !== "" && totalBudgetUsd === null) {
            throw new Error("Enter the budget as a dollar amount of zero or more.");
          }
          await setSeasonBudget(client, {
            orgId,
            userId,
            seasonYear,
            totalBudgetUsd,
            notes: trimmedOrNull(body.notes),
          });
          break;
        }

        case "record-competition-fee": {
          const label = trimmedOrNull(body.label, 200);
          const amountUsd = moneyOrNull(body.amountUsd);
          const incurredOn = isoDate(body.incurredOn);
          if (!label) throw new Error("Name the event or registration this fee is for.");
          if (amountUsd == null) throw new Error("Enter the fee as a dollar amount of zero or more.");
          if (!incurredOn) throw new Error("Pick the date the fee was or will be charged.");
          const kind = body.kind === "registration" ? "registration" : "event_fee";
          const paid = body.paid === true;
          // Reuses the /costs writer, which also mirrors PAID rows onto the
          // unified ledger in this same transaction — so the fee counts once,
          // in the same total the budget subtracts from.
          await addCost(client, {
            orgId,
            userId,
            seasonYear,
            label,
            category: kind,
            amountUsd,
            vendor: trimmedOrNull(body.vendor, 200),
            incurredOn,
            status: paid ? "paid" : "planned",
            notes: trimmedOrNull(body.notes),
          });
          break;
        }

        case "grant-budget-access": {
          if (membership.role !== "owner" && membership.role !== "admin") {
            throw new CapabilityError(
              403,
              "Only owners and admins can give someone budget access.",
              "not_allowed",
            );
          }
          const targetUserId = trimmedOrNull(body.userId, 64);
          if (!targetUserId) throw new Error("Choose who should get budget access.");
          await grantCapability(client, {
            orgId,
            actorUserId: userId,
            targetUserId,
            capability: "manage_budget",
          });
          break;
        }

        case "revoke-budget-access": {
          if (membership.role !== "owner" && membership.role !== "admin") {
            throw new CapabilityError(
              403,
              "Only owners and admins can remove budget access.",
              "not_allowed",
            );
          }
          const targetUserId = trimmedOrNull(body.userId, 64);
          if (!targetUserId) throw new Error("Whose access are you removing?");
          await revokeCapability(client, { orgId, targetUserId, capability: "manage_budget" });
          break;
        }

        default:
          throw new Error("Unknown budget action");
      }

      const view: BudgetView = await computeBudgetView(client, {
        orgId,
        orgName: membership.orgName,
        teamNumber: membership.teamNumber,
        accessVia:
          membership.role === "owner" ? "owner" : membership.role === "admin" ? "admin" : "granted",
        seasonYear,
      });
      const leadership = membership.role === "owner" || membership.role === "admin";
      return {
        view,
        canGrantAccess: leadership,
        grants: leadership ? await listCapabilityGrants(client, orgId, "manage_budget") : [],
        implicitHolders: leadership ? await implicitHolders(client, orgId) : [],
        candidates: leadership ? await grantableMembers(client, orgId, "manage_budget") : [],
      };
    });

    return Response.json(payload);
  } catch (error) {
    return fail(error);
  }
}
