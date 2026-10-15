import {
  AlreadyTeamMemberError,
  auth,
  createOrganizationInvite,
  deliverInviteEmail,
  getAdminTenureSnapshot,
  inviteEmailDeliveryMode,
  listOrganizationInvites,
  ORGANIZATION_INVITE_MAX_HOURS,
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
import { inviteEmailProblem } from "../../../../lib/team/invite-email-address";

// One request is one tap: a pasted list of 20 addresses is one batch, so kickoff night no
// longer hits the limit at address 16, and an address that fails costs nothing extra.
const mutateLimiter = createRateLimiter({ limit: 30, windowMs: 10 * 60_000, namespace: "org-invites" });
const MAX_BATCH = 50;
const orgRole = z.enum(["owner", "admin", "scout", "viewer"]);
const lifetime = z.number().int().min(1).max(ORGANIZATION_INVITE_MAX_HOURS).optional();
// The address is checked by inviteEmailProblem (the same check as the form) so a bad one gets
// a sentence that names it, not "Request fields are invalid."
const createSchema = z
  .object({
    orgId: z.string().uuid(),
    email: z.string().max(400).optional(),
    emails: z.array(z.string().max(400)).min(1).max(MAX_BATCH).optional(),
    role: orgRole,
    expiresInHours: lifetime,
  })
  .strict()
  .refine((body) => Boolean(body.email) !== Boolean(body.emails), { message: "Send email or emails" });
const actionSchema = z
  .object({ orgId: z.string().uuid(), inviteId: z.string().uuid(), action: z.enum(["resend", "revoke"]) })
  .strict();

const NOT_A_MANAGER =
  "Only the team owner, mentors and coaches, and people they allow can invite or see invites. Ask one of them.";

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

const failure = (error: unknown) => {
  if (error instanceof AlreadyTeamMemberError) {
    return privateJson({ error: error.message, code: error.code, userId: error.userId }, { status: 400 });
  }
  // "Organization administrator access required" meant nothing to a student; say who can.
  if (error instanceof Error && /administrator access required/i.test(error.message)) {
    return privateJson({ error: NOT_A_MANAGER, reason: "team_admin_only" }, { status: 403 });
  }
  return securityErrorResponse(error, "Request failed");
};

/** Create one invite in its own transaction and email it; never throws. */
async function createOne(actor: string, input: { orgId: string; email: string; role: OrgRole; expiresInHours?: number }) {
  const problem = inviteEmailProblem(input.email);
  if (problem) return { email: input.email.trim(), ok: false as const, error: problem };
  try {
    const created = await withRls({ userId: actor, orgId: input.orgId }, (client) =>
      createOrganizationInvite(client, actor, {
        orgId: input.orgId,
        email: input.email.trim(),
        role: input.role,
        expiresInHours: input.expiresInHours,
      }),
    );
    const delivery = await deliverInviteEmail(created);
    return { email: created.email, ok: true as const, ...publicCreatedInvite(created, delivery) };
  } catch (error) {
    const response = failure(error);
    const body = (await response.json().catch(() => ({}))) as { error?: string; code?: string; userId?: string };
    return {
      email: input.email.trim(),
      ok: false as const,
      status: response.status,
      error: body.error ?? "Could not create the invite.",
      ...(body.code ? { code: body.code } : {}),
      ...(body.userId ? { userId: body.userId } : {}),
    };
  }
}

export async function GET(request: Request) {
  try {
    const actor = await userId();
    const orgId = new URL(request.url).searchParams.get("orgId");
    if (!orgId || !z.string().uuid().safeParse(orgId).success) {
      return Response.json({ error: "A valid orgId is required" }, { status: 400 });
    }
    const data = await withRls({ userId: actor, orgId }, async (client) => {
      // Invites hold every invited and accepted member's email. Members who can't manage people
      // (a student, a parent) used to read them all here; the roster shows them names only.
      const allowed = await client.query<{ allowed: boolean }>(
        `SELECT has_org_capability($1::uuid, 'manage_members'::org_capability) AS allowed`,
        [orgId],
      );
      if (!allowed.rows[0]?.allowed) return null;
      const invites = await listOrganizationInvites(client, orgId);
      const adminTenure = await getAdminTenureSnapshot(client, orgId);
      // Who is asking, from this fast call: the invite form drew before the slower members call
      // answered and treated the owner as "role unknown" — no Mentor option, "only the owner…".
      const me = await client.query<{ role: string }>(
        `SELECT role::text AS role FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid`,
        [orgId, actor],
      );
      return {
        invites,
        adminTenure,
        delivery: inviteEmailDeliveryMode(),
        actorUserId: actor,
        actorRole: me.rows[0]?.role ?? null,
      };
    });
    if (!data) return privateJson({ error: NOT_A_MANAGER, reason: "team_admin_only" }, { status: 403 });
    return privateJson(data);
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await userId();
    if (!(await mutateLimiter.allow(actor))) {
      return rateLimitedResponse("Too many invite changes in a few minutes. Wait about ten minutes, then try again.");
    }
    const body = await parseSecureJson(request, createSchema);
    if (body.emails) {
      const results = [];
      // One at a time, each in its own transaction: one bad address never undoes the others.
      for (const email of body.emails) {
        results.push(
          await createOne(actor, { orgId: body.orgId, email, role: body.role as OrgRole, expiresInHours: body.expiresInHours }),
        );
      }
      return privateJson({ results }, { status: results.some((row) => row.ok) ? 201 : 400 });
    }
    const one = await createOne(actor, {
      orgId: body.orgId,
      email: body.email ?? "",
      role: body.role as OrgRole,
      expiresInHours: body.expiresInHours,
    });
    if (!one.ok) {
      return privateJson(
        {
          error: one.error,
          ...("code" in one && one.code ? { code: one.code } : {}),
          ...("userId" in one && one.userId ? { userId: one.userId } : {}),
        },
        { status: "status" in one && one.status ? one.status : 400 },
      );
    }
    return privateJson(
      {
        id: one.id,
        expiresAt: one.expiresAt,
        inviteUrl: one.inviteUrl,
        emailSent: one.emailSent,
        delivery: one.delivery,
        ...("emailError" in one && one.emailError ? { emailError: one.emailError } : {}),
      },
      { status: 201 },
    );
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await userId();
    if (!(await mutateLimiter.allow(actor))) {
      return rateLimitedResponse("Too many invite changes in a few minutes. Wait about ten minutes, then try again.");
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
