import {
  assertPlatformAdmin,
  assertPlatformPrivilegeMfa,
  auth,
  createInviteToken,
  createOrganizationAsPlatformAdmin,
  deliverInviteEmail,
  hashEmail,
  inviteAcceptUrl,
  platformAdminDeniedResponse,
  writeAdminAction,
} from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  OWNER_INVITE_HOURS,
  ownerProvisionMode,
  provisionConflictMessage,
  validateProvisionInput,
  type ProvisionConfirmation,
} from "../../../../lib/admin-analytics/provisioning";

// Global Team Manager: create org -> seed owner -> invite, end to end.
// - Owner already has a verified account → membership seeded immediately
//   (createOrganizationAsPlatformAdmin, unchanged).
// - Owner has no verified account yet → the org is still created and a
//   one-time OWNER invite link is returned exactly once (the old flow hard-
//   failed here). RLS support: users_platform_read / org_billing + invites
//   platform policies from migration 0479.

async function session() {
  const value = await auth.api.getSession({ headers: await headers() });
  if (!value) throw new Error("Authentication required");
  return value;
}

export async function GET() {
  try {
    const current = await session();
    const organizations = await withRls({ userId: current.user.id }, async (client) => {
      await assertPlatformAdmin(client);
      return (
        await client.query(
          `SELECT o.id, o.name, o.slug, o.team_number AS "teamNumber",
                  o.created_at AS "createdAt",
                  owner.email AS "ownerEmail",
                  pending.email AS "pendingOwnerEmail",
                  pending.expires_at AS "pendingOwnerInviteExpiresAt"
           FROM organizations o
           LEFT JOIN LATERAL (
             SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id
             WHERE m.org_id = o.id AND m.role = 'owner'
             ORDER BY m.created_at LIMIT 1
           ) owner ON true
           LEFT JOIN LATERAL (
             SELECT i.email, i.expires_at FROM invites i
             WHERE i.org_id = o.id AND i.role = 'owner' AND i.status = 'pending'
               AND i.expires_at > now()
             ORDER BY i.created_at DESC LIMIT 1
           ) pending ON true
           ORDER BY o.team_number`,
        )
      ).rows;
    });
    return Response.json({ organizations });
  } catch (error) {
    return platformAdminDeniedResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const current = await session();
    const body = (await request.json()) as Record<string, unknown>;
    const validated = validateProvisionInput(body);
    if (!validated.ok) return Response.json({ error: validated.error }, { status: 400 });
    const input = validated.value;

    const created = await withRls({ userId: current.user.id }, async (client) => {
      await assertPlatformAdmin(client);
      await assertPlatformPrivilegeMfa(client, {
        userId: current.user.id,
        sessionId: current.session.id,
      });

      const ownerLookup = await client.query<{ id: string; emailVerified: boolean }>(
        `SELECT id, email_verified AS "emailVerified" FROM users
         WHERE lower(email) = lower($1)
         ORDER BY email_verified DESC LIMIT 1`,
        [input.ownerEmail],
      );
      const mode = ownerProvisionMode(ownerLookup.rows[0] ?? null);

      if (mode === "seeded") {
        const orgId = await createOrganizationAsPlatformAdmin(client, current.user.id, input);
        await writeAdminAction(client, {
          actorUserId: current.user.id,
          action: "organization.provisioned",
          targetOrgId: orgId,
          targetUserId: ownerLookup.rows[0]!.id,
          payload: { teamNumber: input.teamNumber, slug: input.slug, ownerMode: mode },
        });
        return { orgId, mode, inviteToken: null as string | null, inviteExpiresAt: null as Date | null };
      }

      // Invited path: create the workspace now; the owner claims it via a
      // one-time invite link once they sign up with this exact email.
      const org = await client.query<{ id: string }>(
        `INSERT INTO organizations(name, slug, team_number) VALUES($1, $2, $3) RETURNING id`,
        [input.name, input.slug, input.teamNumber],
      );
      const orgId = org.rows[0]!.id;
      await client.query(
        `INSERT INTO org_billing(org_id, tier, credit_cap_usd, period_start, period_end)
         VALUES($1, 'free', 0, date_trunc('month', now()), date_trunc('month', now()) + interval '1 month')`,
        [orgId],
      );
      const { token, tokenHash } = createInviteToken();
      const expiresAt = new Date(Date.now() + OWNER_INVITE_HOURS * 3_600_000);
      const invite = await client.query<{ id: string }>(
        `INSERT INTO invites(org_id, email, role, token_hash, invited_by, expires_at)
         VALUES($1, $2, 'owner', $3, $4, $5) RETURNING id`,
        [orgId, input.ownerEmail, tokenHash, current.user.id, expiresAt],
      );
      const emailHash = hashEmail(input.ownerEmail);
      await client.query(
        `INSERT INTO membership_audit_events(org_id, invite_id, actor_user_id, action, target_email_hash, metadata)
         VALUES ($1, NULL, $3, 'organization.created', $4, $5::jsonb),
                ($1, $2, $3, 'invite.created', $4, $6::jsonb)`,
        [
          orgId,
          invite.rows[0]!.id,
          current.user.id,
          emailHash,
          JSON.stringify({ teamNumber: input.teamNumber, seededRole: "owner", ownerMode: mode }),
          JSON.stringify({ role: "owner", expiresAt: expiresAt.toISOString() }),
        ],
      );
      await writeAdminAction(client, {
        actorUserId: current.user.id,
        action: "organization.provisioned",
        targetOrgId: orgId,
        payload: { teamNumber: input.teamNumber, slug: input.slug, ownerMode: mode },
      });
      return { orgId, mode, inviteToken: token, inviteExpiresAt: expiresAt };
    });

    const confirmation: ProvisionConfirmation = {
      id: created.orgId,
      name: input.name,
      slug: input.slug,
      teamNumber: input.teamNumber,
      owner: { email: input.ownerEmail, mode: created.mode },
    };
    if (created.mode === "invited" && created.inviteToken && created.inviteExpiresAt) {
      // Deliver AFTER commit so a slow/failed email never rolls back the org.
      const delivery = await deliverInviteEmail({
        email: input.ownerEmail,
        organization: input.name,
        role: "owner",
        token: created.inviteToken,
        expiresAt: created.inviteExpiresAt,
      });
      confirmation.owner.inviteUrl = inviteAcceptUrl(created.inviteToken);
      confirmation.owner.inviteExpiresAt = created.inviteExpiresAt.toISOString();
      confirmation.owner.emailSent = delivery.emailSent;
    }
    return Response.json(confirmation, { status: 201 });
  } catch (error) {
    const conflict =
      error instanceof Error ? provisionConflictMessage(error.message) : null;
    if (conflict) return Response.json({ error: conflict }, { status: 409 });
    return platformAdminDeniedResponse(error);
  }
}
