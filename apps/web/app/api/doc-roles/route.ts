/**
 * /api/doc-roles — who may create and edit the team's docs.
 *
 * The grant path is owner-only and un-self-assignable, and BOTH of those are
 * enforced in the database (`membership_capabilities_doc_write` WITH CHECK,
 * plus the `membership_capabilities_no_self_grant` constraint). The checks in this
 * route exist so a refusal arrives as a sentence, not as a policy violation —
 * removing them would change the error message, not the outcome.
 *
 * org_id comes from `resolveMembership`, never from the body.
 */

import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  CapabilityError,
  grantCapability,
  resolveMembership,
  revokeCapability,
} from "../../../lib/capabilities/org-capabilities";
import { computeDocRolesView } from "../../../lib/doc-roles/compute-doc-roles";

function trimmedOrNull(value: unknown, max = 500): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function fail(error: unknown): Response {
  if (error instanceof CapabilityError) {
    return Response.json({ error: error.message, reason: error.reason }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "Doc role request failed";
  if (/row-level security/i.test(message)) {
    return Response.json(
      { error: "Only the team owner can change who may edit docs.", reason: "not_allowed" },
      { status: 403 },
    );
  }
  return Response.json({ error: message }, { status: 400 });
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");

  try {
    const view = await withRls({ userId: session.user.id }, async (client) => {
      const membership = await resolveMembership(client, session.user.id, requestedOrg);
      return computeDocRolesView(client, {
        orgId: membership.orgId,
        orgName: membership.orgName,
        role: membership.role,
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

  try {
    const view = await withRls({ userId: session.user.id }, async (client) => {
      const membership = await resolveMembership(client, session.user.id, requestedOrg);
      const orgId = membership.orgId;

      // The owner, or the platform admin who provisioned the team. An admin is
      // deliberately NOT enough: the whole point of this role is that one
      // person decides who writes the team's record.
      const platformAdmin = await client.query<{ allowed: boolean }>(
        `SELECT is_platform_admin() AS allowed`,
      );
      const canGrant = membership.role === "owner" || platformAdmin.rows[0]?.allowed === true;
      if (!canGrant) {
        throw new CapabilityError(
          403,
          membership.role === "admin"
            ? "Only the team owner can grant doc editing. Admins can edit docs, but cannot hand the role out."
            : "Only the team owner can grant doc editing.",
          "not_allowed",
        );
      }

      switch (action) {
        case "grant": {
          const targetUserId = trimmedOrNull(body.userId, 64);
          if (!targetUserId) throw new Error("Choose who should be able to edit docs.");
          await grantCapability(client, {
            orgId,
            actorUserId: session.user.id,
            targetUserId,
            capability: "edit_docs",
          });
          break;
        }

        case "revoke": {
          const targetUserId = trimmedOrNull(body.userId, 64);
          if (!targetUserId) throw new Error("Which doc editor are you removing?");
          await revokeCapability(client, { orgId, targetUserId, capability: "edit_docs" });
          break;
        }

        default:
          throw new Error("Unknown doc role action");
      }

      return computeDocRolesView(client, {
        orgId,
        orgName: membership.orgName,
        role: membership.role,
      });
    });

    return Response.json(view);
  } catch (error) {
    return fail(error);
  }
}
