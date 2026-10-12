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
import { ensureFirstOwnerTeamDefaults } from "../../../../lib/provisioning/owner-defaults";
import {
  OWNER_INVITE_HOURS,
  ownerProvisionMode,
  provisionConflictMessage,
  teamNumberTakenMessage,
  validateProvisionInput,
  type ProvisionConfirmation,
} from "../../../../lib/admin-analytics/provisioning";
import { emailNewOwner, noteNewOwner } from "../../../../lib/admin-analytics/owner-notice";
import { createWaitlistStore, waitlistBackend } from "../../../../lib/marketing/waitlist";
import { lifecycleRefusal, teamDisplayName } from "../../../../lib/team-lifecycle/model";
import { lifecycleErrorResponse } from "../../../../lib/team-lifecycle/respond";
import { deleteTeam } from "../../../../lib/team-lifecycle/store";

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

/** A provisioning refusal with a sentence the admin can act on (409). */
class ProvisionConflict extends Error {}

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
                  pending.expires_at AS "pendingOwnerInviteExpiresAt",
                  COALESCE(pending.expired, false) AS "ownerInviteExpired",
                  (SELECT count(*)::int FROM memberships x WHERE x.org_id = o.id) AS "memberCount"
           FROM organizations o
           LEFT JOIN LATERAL (
             SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id
             WHERE m.org_id = o.id AND m.role = 'owner'
             ORDER BY m.created_at LIMIT 1
           ) owner ON true
           -- The latest owner invite, expired ones included: filtering them out showed
           -- "No owner yet" with no button once a day had passed (QA A2-03).
           LEFT JOIN LATERAL (
             SELECT i.email, i.expires_at, (i.status = 'expired' OR i.expires_at <= now()) AS expired
             FROM invites i
             WHERE i.org_id = o.id AND i.role = 'owner' AND i.status IN ('pending', 'expired')
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

      // The number first: it is the mistake an admin makes (a waitlisted mentor whose team is
      // already here), and the insert would otherwise trip over the web address index first.
      const taken = await client.query<{ name: string }>(
        `SELECT name FROM organizations WHERE team_number = $1::int LIMIT 1`,
        [input.teamNumber],
      );
      if (taken.rows[0]) throw new ProvisionConflict(teamNumberTakenMessage(input.teamNumber, taken.rows[0].name));

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
        return {
          orgId,
          mode,
          ownerUserId: ownerLookup.rows[0]!.id as string | null,
          inviteToken: null as string | null,
          inviteExpiresAt: null as Date | null,
        };
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
      return { orgId, mode, ownerUserId: null as string | null, inviteToken: token, inviteExpiresAt: expiresAt };
    });

    // The same start a /claim team gets (published scout forms, finance categories, the owner's
    // Home, a join code). Row security lets only the team's owner create those, so it runs as the
    // owner just seeded, after the team is committed. An invited owner's team gets them when the
    // owner accepts (invite routes and onboarding). Never undoes the team if it fails.
    let teamDefaults: ProvisionConfirmation["teamDefaults"] = "on_owner_join";
    const teamLabel = teamDisplayName({ teamNumber: input.teamNumber, name: input.name });
    if (created.mode === "seeded" && created.ownerUserId) {
      const ownerUserId = created.ownerUserId;
      const outcome = await withRls({ userId: ownerUserId, orgId: created.orgId }, (client) =>
        ensureFirstOwnerTeamDefaults(client, created.orgId, ownerUserId),
      ).catch(() => null);
      teamDefaults = outcome?.defaults ? "ready" : "pending";
      // The owner hears about it in Vantage (written as them: notifications_self).
      await withRls({ userId: ownerUserId, orgId: created.orgId }, (client) =>
        noteNewOwner(client, { userId: ownerUserId, orgId: created.orgId, teamLabel }),
      ).catch(() => undefined);
    }

    const confirmation: ProvisionConfirmation = {
      id: created.orgId,
      name: input.name,
      slug: input.slug,
      teamNumber: input.teamNumber,
      owner: { email: input.ownerEmail, mode: created.mode },
      teamDefaults,
    };
    if (created.mode === "seeded") {
      // ...and by email, after commit, so a slow mail service never undoes the team (A2-08).
      const notice = await emailNewOwner({ email: input.ownerEmail, teamLabel, orgId: created.orgId });
      confirmation.owner.emailSent = notice.emailSent;
      confirmation.owner.delivery = notice.delivery;
    }
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
    // A waitlist entry for this email is done: the team exists (QA A2-09). Best effort; the
    // waitlist can live in its own database, and a miss here never fails the team.
    confirmation.waitlistConverted = await markWaitlistConverted(input.ownerEmail);
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
    if (error instanceof ProvisionConflict) return Response.json({ error: error.message }, { status: 409 });
    const conflict =
      error instanceof Error ? provisionConflictMessage(error.message) : null;
    if (conflict) return Response.json({ error: conflict }, { status: 409 });
    return platformAdminDeniedResponse(error);
  }
}

async function markWaitlistConverted(email: string): Promise<boolean> {
  if (waitlistBackend() === "unavailable") return false;
  try {
    return Boolean(await createWaitlistStore().markConverted(email));
  } catch {
    return false;
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
      // An expired owner invite is reissued too (QA A2-03): it is the case the button exists for.
      // Only while nobody owns the team yet; a revoked or accepted invite is never brought back.
      const row = await client.query<{ email: string; organization: string }>(
        `UPDATE invites i SET token_hash = $2, expires_at = $3, last_sent_at = now(), status = 'pending'
           FROM organizations o
          WHERE i.org_id = $1::uuid AND o.id = i.org_id AND i.role = 'owner' AND i.status IN ('pending', 'expired')
            AND i.id = (SELECT latest.id FROM invites latest
                         WHERE latest.org_id = $1::uuid AND latest.role = 'owner' AND latest.status IN ('pending', 'expired')
                         ORDER BY latest.created_at DESC LIMIT 1)
            AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.org_id = $1::uuid AND m.role = 'owner')
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
    if (!rotated) {
      return Response.json({ error: "This team has no owner invite to replace. Its owner may have joined already; reload the list." }, { status: 404 });
    }
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

/**
 * Delete a team as a platform admin: one made by mistake (a wrong number, a test team) or one whose
 * owner never joined, which nobody else can delete. `{ orgId, confirm }`, confirm being the typed
 * team number. The same delete_team (0720) an owner uses; members are told why it is gone.
 */
export async function DELETE(request: Request) {
  try {
    const current = await session();
    const body = (await request.json().catch(() => ({}))) as { orgId?: unknown; confirm?: unknown };
    const orgId = typeof body.orgId === "string" ? body.orgId.trim() : "";
    if (!/^[0-9a-f-]{36}$/i.test(orgId)) return Response.json({ error: "Pick a team to delete." }, { status: 400 });
    await withRls({ userId: current.user.id }, async (client) => {
      await assertPlatformAdmin(client);
      await assertPlatformPrivilegeMfa(client, { userId: current.user.id, sessionId: current.session.id });
      await deleteTeam(client, orgId, typeof body.confirm === "string" ? body.confirm.trim() : "");
    });
    return Response.json({ deleted: true });
  } catch (error) {
    if (lifecycleRefusal(error)) return lifecycleErrorResponse(error, "delete_team");
    return platformAdminDeniedResponse(error);
  }
}
