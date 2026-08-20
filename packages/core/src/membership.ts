import type { PoolClient } from "@neondatabase/serverless";
import {
  createEmailProvider,
  hashEmail,
  inviteAcceptUrl,
  type EmailProvider,
} from "./email";
import { createInviteToken, type OrgRole } from "./index";
import { assertOrgCapability } from "./capabilities";

const normalizeEmail = (email: string) => email.trim().toLowerCase();

async function audit(
  client: PoolClient,
  input: {
    orgId?: string;
    inviteId?: string;
    actorUserId: string;
    action: string;
    email?: string;
    metadata?: Record<string, unknown>;
  },
) {
  await client.query(
    `INSERT INTO membership_audit_events(
      org_id,invite_id,actor_user_id,action,target_email_hash,metadata
    ) VALUES($1,$2,$3,$4,$5,$6::jsonb)`,
    [
      input.orgId ?? null,
      input.inviteId ?? null,
      input.actorUserId,
      input.action,
      input.email ? hashEmail(input.email) : null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}

export async function createOrganizationAsPlatformAdmin(
  client: PoolClient,
  actorUserId: string,
  input: { name: string; slug: string; teamNumber: number; ownerEmail: string },
) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug))
    throw new Error("Slug must use lowercase letters, numbers, and hyphens");
  if (!Number.isInteger(input.teamNumber) || input.teamNumber < 1 || input.teamNumber > 99999)
    throw new Error("Team number must be between 1 and 99999");
  const admin = await client.query("SELECT is_platform_admin() AS allowed");
  if (!admin.rows[0]?.allowed) throw new Error("Platform administrator access required");
  const owner = await client.query<{ id: string }>(
    `SELECT id FROM users WHERE lower(email)=lower($1) AND email_verified=true`,
    [normalizeEmail(input.ownerEmail)],
  );
  if (!owner.rows[0]) throw new Error("The first owner must have a verified Vantage account");
  const org = await client.query<{ id: string }>(
    `INSERT INTO organizations(name,slug,team_number) VALUES($1,$2,$3) RETURNING id`,
    [input.name.trim(), input.slug, input.teamNumber],
  );
  const orgId = org.rows[0]!.id;
  await client.query(
    `INSERT INTO memberships(org_id,user_id,role) VALUES($1,$2,'owner')`,
    [orgId, owner.rows[0].id],
  );
  await client.query(
    `INSERT INTO org_billing(org_id,tier,credit_cap_usd,period_start,period_end)
     VALUES($1,'free',0,date_trunc('month',now()),date_trunc('month',now())+interval '1 month')`,
    [orgId],
  );
  await audit(client, {
    orgId,
    actorUserId,
    action: "organization.created",
    email: input.ownerEmail,
    metadata: { teamNumber: input.teamNumber, seededRole: "owner" },
  });
  return orgId;
}

export type InviteDeliveryMode = "resend" | "local" | "unconfigured" | "failed";

export type CreatedOrganizationInvite = {
  id: string;
  expiresAt: Date;
  email: string;
  role: OrgRole;
  organization: string;
  /** Raw token — never persist; only used to build a one-time copy link / email. */
  token: string;
};

export function inviteEmailDeliveryMode(
  provider: EmailProvider = createEmailProvider(),
): Exclude<InviteDeliveryMode, "failed"> {
  if (provider.name === "resend") return "resend";
  if (provider.name === "local-mailbox") return "local";
  return "unconfigured";
}

export async function deliverInviteEmail(
  invite: {
    email: string;
    organization: string;
    role: OrgRole | string;
    token: string;
    expiresAt: Date;
  },
  provider: EmailProvider = createEmailProvider(),
): Promise<{ emailSent: boolean; delivery: InviteDeliveryMode; error?: string }> {
  const mode = inviteEmailDeliveryMode(provider);
  if (mode === "unconfigured") {
    return { emailSent: false, delivery: "unconfigured" };
  }
  try {
    await provider.sendInvite({
      email: invite.email,
      organization: invite.organization,
      role: invite.role,
      token: invite.token,
      expiresAt: invite.expiresAt,
    });
    return { emailSent: true, delivery: mode };
  } catch (error) {
    return {
      emailSent: false,
      delivery: "failed",
      error: error instanceof Error ? error.message : "Email could not be sent",
    };
  }
}

export function publicCreatedInvite(invite: CreatedOrganizationInvite, delivery: {
  emailSent: boolean;
  delivery: InviteDeliveryMode;
  error?: string;
}) {
  return {
    id: invite.id,
    expiresAt: invite.expiresAt,
    inviteUrl: inviteAcceptUrl(invite.token),
    emailSent: delivery.emailSent,
    delivery: delivery.delivery,
    ...(delivery.error ? { emailError: delivery.error } : {}),
  };
}

export async function createOrganizationInvite(
  client: PoolClient,
  actorUserId: string,
  input: { orgId: string; email: string; role: OrgRole; expiresInHours?: number },
): Promise<CreatedOrganizationInvite> {
  const email = normalizeEmail(input.email);
  await assertOrgCapability(client, input.orgId, "manage_members");
  if (input.role === "owner") {
    const actor = await client.query<{ role: OrgRole }>(
      `SELECT role FROM memberships WHERE org_id=$1 AND user_id=$2`,
      [input.orgId, actorUserId],
    );
    if (actor.rows[0]?.role !== "owner")
      throw new Error("Only an owner may invite another owner");
  }
  const existing = await client.query(
    `SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id
     WHERE m.org_id=$1 AND lower(u.email)=lower($2)`,
    [input.orgId, email],
  );
  if (existing.rowCount) throw new Error("This email is already a member");
  const { token, tokenHash } = createInviteToken();
  const expiresAt = new Date(
    Date.now() + Math.min(Math.max(input.expiresInHours ?? 72, 1), 168) * 3_600_000,
  );

  const pending = await client.query<{ id: string }>(
    `SELECT id FROM invites
      WHERE org_id=$1::uuid AND lower(email)=lower($2) AND status='pending'
      ORDER BY created_at DESC
      LIMIT 1`,
    [input.orgId, email],
  );

  let invite: { id: string; organization: string };
  if (pending.rows[0]) {
    const rotated = await client.query<{ id: string; organization: string }>(
      `UPDATE invites SET token_hash=$1, role=$2, expires_at=$3, last_sent_at=now(), invited_by=$4
       WHERE id=$5 AND org_id=$6 AND status='pending'
       RETURNING id, (SELECT name FROM organizations WHERE id=$6) AS organization`,
      [tokenHash, input.role, expiresAt, actorUserId, pending.rows[0].id, input.orgId],
    );
    invite = rotated.rows[0]!;
    await audit(client, {
      orgId: input.orgId,
      inviteId: invite.id,
      actorUserId,
      action: "invite.rotated",
      email,
      metadata: { role: input.role, expiresAt: expiresAt.toISOString() },
    });
  } else {
    const inserted = await client.query<{ id: string; organization: string }>(
      `INSERT INTO invites(org_id,email,role,token_hash,invited_by,expires_at)
       SELECT o.id,$2,$3,$4,$5,$6 FROM organizations o WHERE o.id=$1
       RETURNING id,(SELECT name FROM organizations WHERE id=$1) AS organization`,
      [input.orgId, email, input.role, tokenHash, actorUserId, expiresAt],
    );
    invite = inserted.rows[0]!;
    await audit(client, {
      orgId: input.orgId,
      inviteId: invite.id,
      actorUserId,
      action: "invite.created",
      email,
      metadata: { role: input.role, expiresAt: expiresAt.toISOString() },
    });
  }

  return {
    id: invite.id,
    expiresAt,
    email,
    role: input.role,
    organization: invite.organization,
    token,
  };
}

export async function resendOrganizationInvite(
  client: PoolClient,
  actorUserId: string,
  orgId: string,
  inviteId: string,
): Promise<CreatedOrganizationInvite> {
  const { token, tokenHash } = createInviteToken();
  const result = await client.query<{
    id: string;
    email: string;
    role: OrgRole;
    organization: string;
    expiresAt: Date;
  }>(
    `UPDATE invites i SET token_hash=$1,expires_at=now()+interval '72 hours',
       last_sent_at=now()
     FROM organizations o WHERE i.id=$2 AND i.org_id=$3 AND i.org_id=o.id
       AND i.status='pending' AND has_org_capability(i.org_id,'manage_members'::org_capability)
     RETURNING i.id,i.email,i.role,o.name AS organization,i.expires_at AS "expiresAt"`,
    [tokenHash, inviteId, orgId],
  );
  const invite = result.rows[0];
  if (!invite) throw new Error("Pending invite not found");
  await audit(client, {
    orgId,
    inviteId,
    actorUserId,
    action: "invite.resent",
    email: invite.email,
  });
  return {
    id: invite.id,
    expiresAt: invite.expiresAt,
    email: invite.email,
    role: invite.role,
    organization: invite.organization,
    token,
  };
}

export async function revokeOrganizationInvite(
  client: PoolClient,
  actorUserId: string,
  orgId: string,
  inviteId: string,
) {
  const result = await client.query<{ email: string }>(
    `UPDATE invites SET status='revoked'
     WHERE id=$1 AND org_id=$2 AND status='pending'
       AND has_org_capability(org_id,'manage_members'::org_capability)
     RETURNING email`,
    [inviteId, orgId],
  );
  if (!result.rows[0]) throw new Error("Pending invite not found");
  await audit(client, {
    orgId,
    inviteId,
    actorUserId,
    action: "invite.revoked",
    email: result.rows[0].email,
  });
}

export type InvitePreview = {
  orgId: string;
  orgName: string;
  teamNumber: number;
  role: string;
  email: string;
  status: string;
  expiresAt: string;
};

export async function peekOrganizationInvite(
  client: PoolClient,
  token: string,
): Promise<InvitePreview | null> {
  const result = await client.query<{
    org_id: string;
    org_name: string;
    team_number: number;
    role: string;
    email: string;
    status: string;
    expires_at: Date;
  }>(`SELECT org_id, org_name, team_number, role, email, status, expires_at FROM peek_org_invite($1)`, [token]);
  const row = result.rows[0];
  if (!row) return null;
  return {
    orgId: row.org_id,
    orgName: row.org_name,
    teamNumber: row.team_number,
    role: row.role,
    email: row.email,
    status: row.status,
    expiresAt: row.expires_at.toISOString(),
  };
}

export async function acceptOrganizationInvite(
  client: PoolClient,
  actorUserId: string,
  token: string,
) {
  const result = await client.query<{ orgId: string }>(
    `SELECT accept_org_invite($1) AS "orgId"`,
    [token],
  );
  const orgId = result.rows[0]!.orgId;
  await audit(client, { orgId, actorUserId, action: "invite.accepted" });
  return orgId;
}

export async function listOrganizationInvites(client: PoolClient, orgId: string) {
  await client.query("SELECT expire_org_invites()");
  const result = await client.query(
    `SELECT id,email,role,status,expires_at AS "expiresAt",
      accepted_at AS "acceptedAt",last_sent_at AS "lastSentAt",created_at AS "createdAt"
     FROM invites WHERE org_id=$1 ORDER BY created_at DESC`,
    [orgId],
  );
  return result.rows;
}

export type WorkspaceAccessRequest = {
  id: string;
  userId: string;
  name: string;
  email: string;
  requestedTeamRole: string | null;
  crewRole: string | null;
  roleDescription: string | null;
  primaryFocus: "competition" | "build" | "business" | "leadership";
  status: "pending" | "approved" | "declined" | "withdrawn";
  membershipRole: OrgRole | null;
  createdAt: string;
  reviewedAt: string | null;
};

export async function listWorkspaceAccessRequests(
  client: PoolClient,
  orgId: string,
): Promise<WorkspaceAccessRequest[]> {
  await assertOrgCapability(client, orgId, "manage_members");
  const result = await client.query<WorkspaceAccessRequest>(
    `SELECT r.id,r.user_id AS "userId",u.name,u.email,
            r.requested_team_role AS "requestedTeamRole",r.primary_focus AS "primaryFocus",
            r.crew_role AS "crewRole",r.role_description AS "roleDescription",
            r.status,r.membership_role AS "membershipRole",
            r.created_at::text AS "createdAt",r.reviewed_at::text AS "reviewedAt"
     FROM workspace_access_requests r
     JOIN users u ON u.id=r.user_id
     WHERE r.org_id=$1
     ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END,r.created_at DESC
     LIMIT 100`,
    [orgId],
  );
  return result.rows;
}

export async function reviewWorkspaceAccessRequest(
  client: PoolClient,
  actorUserId: string,
  input: {
    orgId: string;
    requestId: string;
    decision: "approved" | "declined";
    role?: "scout" | "viewer";
  },
  provider: EmailProvider = createEmailProvider(),
) {
  await assertOrgCapability(client, input.orgId, "manage_members");
  const role = input.role === "scout" ? "scout" : "viewer";
  const result = await client.query<{
    requestId: string;
    applicantUserId: string;
    applicantEmail: string;
    applicantName: string;
    organizationId: string;
    organizationName: string;
    decision: "approved" | "declined";
    grantedRole: "scout" | "viewer" | null;
  }>(
    `SELECT request_id AS "requestId",applicant_user_id AS "applicantUserId",
            applicant_email AS "applicantEmail",applicant_name AS "applicantName",
            organization_id AS "organizationId",organization_name AS "organizationName",
            decision,granted_role AS "grantedRole"
     FROM review_workspace_access($1,$2,$3::org_role)`,
    [input.requestId, input.decision, role],
  );
  const reviewed = result.rows[0];
  if (!reviewed || reviewed.organizationId !== input.orgId) {
    throw new Error("Pending access request not found");
  }

  if (reviewed.decision === "approved") {
    const baseUrl = (process.env.BETTER_AUTH_URL ?? "http://localhost:3001").replace(/\/$/, "");
    const nextPath = `/workspace?orgId=${encodeURIComponent(reviewed.organizationId)}`;
    const signInUrl = `${baseUrl}/signin?next=${encodeURIComponent(nextPath)}`;
    await provider.sendSecurityNotice({
      email: reviewed.applicantEmail,
      subject: `You are approved to join ${reviewed.organizationName} on Vantage`,
      message:
        `Your team leader approved your Vantage workspace request as ${reviewed.grantedRole}. ` +
        `Sign in with this verified email to enter the team workspace: ${signInUrl}\n\n` +
        "If you did not request this access, contact the team administrator.",
    });
  }

  await audit(client, {
    orgId: reviewed.organizationId,
    actorUserId,
    action: `workspace_access.${reviewed.decision}`,
    email: reviewed.applicantEmail,
    metadata: {
      requestId: reviewed.requestId,
      grantedRole: reviewed.grantedRole,
      requestedByUserId: reviewed.applicantUserId,
    },
  });
  return reviewed;
}
