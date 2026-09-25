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
import { after } from "next/server";
import { ensureHubSheetForNewTeam, loadSheetsHubBridge, teamSheetTitle } from "../../../../lib/google-sheets/sheets-hub";
import {
  OWNER_INVITE_HOURS,
  ownerProvisionMode,
  provisionConflictMessage,
  validateProvisionInput,
  type ProvisionConfirmation,
} from "../../../../lib/admin-analytics/provisioning";

// Platform admin: create org -> seed owner -> invite, end to end.
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

      // Invited path: create the team now; the owner claims it via a
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
      confirmation.owner.delivery = delivery.delivery;
    }
    // The team's spreadsheet in the VantageFRC folder, made now so it is there on day one.
    // After the response, and never fatal: a slow Google cannot hold up or undo the team.
    after(async () => {
      const bridge = await withRls({ userId: current.user.id }, (client) => loadSheetsHubBridge(client)).catch(() => null);
      await ensureHubSheetForNewTeam(
        {
          key: created.orgId,
          number: input.teamNumber ?? null,
          name: input.name,
          title: teamSheetTitle(input.teamNumber ?? null, input.name),
          viewers: [],
        },
        bridge,
      );
    });
    return Response.json(confirmation, { status: 201 });
  } catch (error) {
    const conflict =
      error instanceof Error ? provisionConflictMessage(error.message) : null;
    if (conflict) return Response.json({ error: conflict }, { status: 409 });
    return platformAdminDeniedResponse(error);
  }
}

/**
 * A new owner link for a team whose owner has not joined yet. Links are never stored in plain
 * text, so the one shown at creation cannot be shown again; this makes a fresh one (the old one
 * stops working) and emails it when email is on. Rotation is allowed by the 0479 platform policy.
 */
export async function PATCH(request: Request) {
  try {
    const current = await session();
    const body = (await request.json().catch(() => ({}))) as { action?: unknown; orgId?: unknown };
    const orgId = typeof body.orgId === "string" ? body.orgId.trim() : "";
    if (body.action !== "owner_link" || !/^[0-9a-f-]{36}$/i.test(orgId)) {
      return Response.json({ error: "Pick a team with an owner invite waiting." }, { status: 400 });
    }
    const rotated = await withRls({ userId: current.user.id }, async (client) => {
      await assertPlatformAdmin(client);
      await assertPlatformPrivilegeMfa(client, { userId: current.user.id, sessionId: current.session.id });
      const { token, tokenHash } = createInviteToken();
      const expiresAt = new Date(Date.now() + OWNER_INVITE_HOURS * 3_600_000);
      const row = await client.query<{ email: string; organization: string }>(
        `UPDATE invites i SET token_hash = $2, expires_at = $3, last_sent_at = now()
           FROM organizations o
          WHERE i.org_id = $1::uuid AND o.id = i.org_id AND i.role = 'owner' AND i.status = 'pending'
          RETURNING i.email, o.name AS organization`,
        [orgId, tokenHash, expiresAt],
      );
      const invite = row.rows[0];
      if (!invite) return null;
      await writeAdminAction(client, {
        actorUserId: current.user.id,
        action: "organization.owner_link_reissued",
        targetOrgId: orgId,
        payload: {},
      });
      return { token, expiresAt, email: invite.email, organization: invite.organization };
    });
    if (!rotated) return Response.json({ error: "This team has no owner invite waiting." }, { status: 404 });
    const delivery = await deliverInviteEmail({
      email: rotated.email,
      organization: rotated.organization,
      role: "owner",
      token: rotated.token,
      expiresAt: rotated.expiresAt,
    });
    return Response.json({
      inviteUrl: inviteAcceptUrl(rotated.token),
      expiresAt: rotated.expiresAt.toISOString(),
      email: rotated.email,
      emailSent: delivery.emailSent && delivery.delivery !== "local",
    });
  } catch (error) {
    return platformAdminDeniedResponse(error);
  }
}
