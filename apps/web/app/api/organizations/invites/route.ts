import {
  auth,
  createOrganizationInvite,
  deliverInviteEmail,
  getAdminTenureSnapshot,
  inviteEmailDeliveryMode,
  listOrganizationInvites,
  publicCreatedInvite,
  resendOrganizationInvite,
  revokeOrganizationInvite,
  type OrgRole,
} from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { z } from "zod";
import { createRateLimiter, rateLimitedResponse } from "../../../../lib/rate-limit";
import { parseSecureJson, securityErrorResponse } from "../../../../lib/security/request";

const mutateLimiter = createRateLimiter({ limit: 15, windowMs: 10 * 60_000, namespace: "org-invites" });
const orgRole = z.enum(["owner", "admin", "scout", "viewer"]);
const createSchema = z
  .object({ orgId: z.string().uuid(), email: z.string().trim().email().max(254), role: orgRole })
  .strict();
const actionSchema = z
  .object({ orgId: z.string().uuid(), inviteId: z.string().uuid(), action: z.enum(["resend", "revoke"]) })
  .strict();

function privateJson(value: unknown, init?: ResponseInit) {
  const response = Response.json(value, init);
  response.headers.set("cache-control", "private, no-store, max-age=0");
  return response;
}

async function userId() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Authentication required");
  return session.user.id;
}

const failure = (error: unknown) => securityErrorResponse(error, "Request failed");

export async function GET(request: Request) {
  try {
    const actor = await userId();
    const orgId = new URL(request.url).searchParams.get("orgId");
    if (!orgId || !z.string().uuid().safeParse(orgId).success) {
      return Response.json({ error: "A valid orgId is required" }, { status: 400 });
    }
    const data = await withRls({ userId: actor, orgId }, async (client) => {
      const invites = await listOrganizationInvites(client, orgId);
      const adminTenure = await getAdminTenureSnapshot(client, orgId);
      return { invites, adminTenure, delivery: inviteEmailDeliveryMode() };
    });
    return privateJson(data);
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await userId();
    if (!(await mutateLimiter.allow(actor))) {
      return rateLimitedResponse("Too many invite changes. Wait a few minutes and try again.");
    }
    const body = await parseSecureJson(request, createSchema);
    const created = await withRls({ userId: actor, orgId: body.orgId }, (client) =>
      createOrganizationInvite(client, actor, {
        orgId: body.orgId,
        email: body.email,
        role: body.role as OrgRole,
      }),
    );
    const delivery = await deliverInviteEmail(created);
    return privateJson(publicCreatedInvite(created, delivery), { status: 201 });
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await userId();
    if (!(await mutateLimiter.allow(actor))) {
      return rateLimitedResponse("Too many invite changes. Wait a few minutes and try again.");
    }
    const body = await parseSecureJson(request, actionSchema);
    if (body.action === "revoke") {
      await withRls({ userId: actor, orgId: body.orgId }, (client) =>
        revokeOrganizationInvite(client, actor, body.orgId, body.inviteId),
      );
      return privateJson({ success: true });
    }
    const resent = await withRls({ userId: actor, orgId: body.orgId }, (client) =>
      resendOrganizationInvite(client, actor, body.orgId, body.inviteId),
    );
    const delivery = await deliverInviteEmail(resent);
    return privateJson({ success: true, ...publicCreatedInvite(resent, delivery) });
  } catch (error) {
    return failure(error);
  }
}
