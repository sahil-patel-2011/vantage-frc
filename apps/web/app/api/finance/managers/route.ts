/**
 * /api/finance/managers — who manages the team's money, and the owner's switch.
 *
 * GET  (any member): the finance managers by name, whether the caller is one,
 *      and — for an owner — the people they could choose.
 * POST (owner only): { action: "grant" | "revoke", userId } hands out or takes
 *      back "Manage money" (the `manage_budget` capability, 0714).
 *
 * The rules live in the database: membership_capabilities_budget_write lets only
 * an owner (or the platform admin recovering a team) write the row, a CHECK and
 * the WITH CHECK refuse a self-grant, and a trigger refuses owners and viewers as
 * grantees. The checks below exist so a person reads a sentence, not a policy
 * violation. org_id comes from the caller's own memberships, never the body.
 */

import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import type { PoolClient } from "@neondatabase/serverless";
import { headers } from "next/headers";
import {
  CapabilityError,
  grantCapability,
  grantableMembers,
  resolveMembership,
  revokeCapability,
  type OrgMembership,
} from "../../../../lib/capabilities/org-capabilities";
import {
  MANAGE_MONEY_DESCRIPTION,
  MANAGE_MONEY_LABEL,
  canManageFinances,
  describeFinanceManagers,
  listFinanceManagers,
} from "../../../../lib/finance/finance-managers";
import { publicErrorMessage } from "../../../../lib/security/public-error";

const OWNER_ONLY = "Only the team owner can choose who manages money.";

function fail(error: unknown): Response {
  if (error instanceof CapabilityError) {
    return Response.json({ error: error.message, reason: error.reason }, { status: error.status });
  }
  const message = publicErrorMessage(error, "Finance managers request failed");
  if (/row-level security/i.test(message)) {
    return Response.json({ error: OWNER_ONLY, reason: "not_allowed" }, { status: 403 });
  }
  return Response.json({ error: message }, { status: 400 });
}

async function payload(client: PoolClient, membership: OrgMembership) {
  const isOwner = membership.role === "owner";
  const managers = await listFinanceManagers(client, membership.orgId);
  return {
    orgId: membership.orgId,
    role: membership.role,
    label: MANAGE_MONEY_LABEL,
    description: MANAGE_MONEY_DESCRIPTION,
    canManageFinances: await canManageFinances(client, membership.orgId),
    canChoose: isOwner,
    managers,
    summary: describeFinanceManagers(managers),
    candidates: isOwner ? await grantableMembers(client, membership.orgId, "manage_budget") : [],
  };
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Your session ended. Sign in again." }, { status: 401 });
  const requestedOrg = new URL(request.url).searchParams.get("orgId");
  try {
    const body = await withRls({ userId: session.user.id }, async (client) =>
      payload(client, await resolveMembership(client, session.user.id, requestedOrg)),
    );
    return Response.json(body);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Your session ended. Sign in again." }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const requestedOrg =
    new URL(request.url).searchParams.get("orgId") ?? (typeof body.orgId === "string" ? body.orgId : null);
  const action = body.action;
  const targetUserId = typeof body.userId === "string" ? body.userId.trim() : "";

  try {
    const result = await withRls({ userId: session.user.id }, async (client) => {
      const membership = await resolveMembership(client, session.user.id, requestedOrg);
      if (membership.role !== "owner") throw new CapabilityError(403, OWNER_ONLY, "not_allowed");
      if (!targetUserId) throw new CapabilityError(400, "Choose a person on this team.", "not_a_member");
      if (action === "grant") {
        await grantCapability(client, {
          orgId: membership.orgId,
          actorUserId: session.user.id,
          targetUserId,
          capability: "manage_budget",
        });
      } else if (action === "revoke") {
        await revokeCapability(client, { orgId: membership.orgId, targetUserId, capability: "manage_budget" });
      } else {
        throw new CapabilityError(400, "Unknown action. Use grant or revoke.", "bad_request");
      }
      return payload(client, membership);
    });
    return Response.json(result);
  } catch (error) {
    return fail(error);
  }
}
