import {
  auth,
  createOrganizationInvite,
  listOrganizationInvites,
  resendOrganizationInvite,
  revokeOrganizationInvite,
  type OrgRole,
} from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { createRateLimiter, rateLimitedResponse } from "../../../../lib/rate-limit";

const mutateLimiter = createRateLimiter({ limit: 15, windowMs: 10 * 60_000, namespace: "org-invites" });

async function userId() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Authentication required");
  return session.user.id;
}

const failure = (error: unknown) =>
  Response.json({ error: error instanceof Error ? error.message : "Request failed" }, { status: 400 });

export async function GET(request: Request) {
  try {
    const actor = await userId();
    const orgId = new URL(request.url).searchParams.get("orgId");
    if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });
    const invites = await withRls({ userId: actor, orgId }, (client) =>
      listOrganizationInvites(client, orgId),
    );
    return Response.json({ invites });
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
    const body = (await request.json()) as { orgId?: string; email?: string; role?: OrgRole };
    if (!body.orgId || !body.email || !body.role)
      return Response.json({ error: "orgId, email, and role are required" }, { status: 400 });
    const invite = await withRls({ userId: actor, orgId: body.orgId }, (client) =>
      createOrganizationInvite(client, actor, {
        orgId: body.orgId!,
        email: body.email!,
        role: body.role!,
      }),
    );
    return Response.json(invite, { status: 201 });
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
    const body = (await request.json()) as {
      orgId?: string;
      inviteId?: string;
      action?: "resend" | "revoke";
    };
    if (!body.orgId || !body.inviteId || !body.action)
      return Response.json({ error: "Invalid invite action" }, { status: 400 });
    await withRls({ userId: actor, orgId: body.orgId }, (client) =>
      body.action === "resend"
        ? resendOrganizationInvite(client, actor, body.orgId!, body.inviteId!)
        : revokeOrganizationInvite(client, actor, body.orgId!, body.inviteId!),
    );
    return Response.json({ success: true });
  } catch (error) {
    return failure(error);
  }
}
