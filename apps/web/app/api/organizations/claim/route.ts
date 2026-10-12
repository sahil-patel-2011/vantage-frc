import {
  assertLegalAccepted,
  auth,
  claimFrcTeamWorkspace,
  recordLegalAcceptance,
} from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { parseClaimAttestation, recordTeamClaimAttestation } from "../../../../lib/claim/attestation";
import { anonymizeIp, clientIp } from "../../../../lib/rate-limit";
import { publicErrorMessage } from "../../../../lib/security/public-error";
import { startTeamProvisioning } from "../../../../lib/provisioning/start";
import { initializeTeamDefaults } from "../../../../lib/provisioning/defaults";
import { setTeamJoinCode } from "../../../../lib/team/join-code";

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Your session ended. Sign in again." }, { status: 401 });

  let body: {
    name?: string;
    slug?: string;
    teamNumber?: number;
    termsAccepted?: boolean;
    privacyAccepted?: boolean;
    authorizationAcknowledged?: unknown;
    attestationVersion?: unknown;
    joinPin?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body || !body.name || !body.slug || !body.teamNumber) {
    return Response.json({ error: "name, slug, and teamNumber are required" }, { status: 400 });
  }

  try {
    // Creating a team is an entry point: the server re-validates both
    // consents before anything is written. A client checkbox is not consent.
    assertLegalAccepted({
      termsAccepted: body.termsAccepted,
      privacyAccepted: body.privacyAccepted,
    });
  } catch (error) {
    const message = publicErrorMessage(error, "Consent is required.");
    return Response.json({ error: message }, { status: 400 });
  }

  // Same rule for the authorization statement: claiming a number is a
  // statement that you represent that team, and the checkbox on /claim is only
  // a convenience. Without an explicit `true` for the current wording, nothing
  // is written.
  const attestation = parseClaimAttestation(body);
  if (!attestation.ok) {
    return Response.json({ error: attestation.message, field: "authorization" }, { status: 400 });
  }

  const teamNumber = Number(body.teamNumber);
  const ip = clientIp(request);
  const ipHash = ip && ip !== "unknown" ? anonymizeIp(ip, "team-claim") : null;

  try {
    // A team number is not first come, first served any more: anyone but a platform admin files a
    // request, which the platform admins approve from Platform admin › Teams (migration 0733).
    const requested = await withRls({ userId: session.user.id }, async (client) => {
      const admin = await client.query<{ allowed: boolean }>(`SELECT is_platform_admin() AS allowed`);
      if (admin.rows[0]?.allowed) return null;
      await recordLegalAcceptance(client, session.user.id);
      const profile = await client.query<{ teamRole: string | null; primaryFocus: string | null; crewRole: string | null }>(
        `SELECT team_role AS "teamRole", primary_focus AS "primaryFocus", crew_role AS "crewRole"
           FROM profiles WHERE user_id = $1::uuid`,
        [session.user.id],
      );
      const row = profile.rows[0];
      const id = await client.query<{ id: string | null }>(
        `SELECT request_team_setup($1::int, $2::text, $3::text, $4::text, NULL, $5::text) AS id`,
        [teamNumber, row?.teamRole ?? null, row?.primaryFocus ?? "leadership", row?.crewRole ?? null, body.name!.trim()],
      );
      return { requestId: id.rows[0]?.id ?? null };
    });
    if (requested) {
      return Response.json({ requested: true, requestId: requested.requestId, teamNumber }, { status: 202 });
    }

    // withRls runs the callback inside one BEGIN/COMMIT, so the acceptance row,
    // the team and the authorization statement are committed together or not
    // at all — a team is never created without its statement on record.
    const id = await withRls({ userId: session.user.id }, async (client) => {
      await recordLegalAcceptance(client, session.user.id);
      const orgId = await claimFrcTeamWorkspace(client, session.user.id, {
        name: body.name!,
        slug: body.slug!,
        teamNumber,
      });
      await recordTeamClaimAttestation(client, {
        orgId,
        userId: session.user.id,
        teamNumber,
        ipHash,
      });
      await client.query("INSERT INTO team_provisioning_jobs(org_id,requested_by) VALUES($1::uuid,$2::uuid) ON CONFLICT(org_id) DO NOTHING", [orgId, session.user.id]);
      await initializeTeamDefaults(client, orgId, { inTransaction: true });
      // A code the founder typed is a choice to use one, so it is on; a blank one is made off
      // until they turn it on in Team admin. Either way joiners start as Parent or guest (0721).
      await setTeamJoinCode(client, orgId, body.joinPin?.trim() || undefined, { enable: Boolean(body.joinPin?.trim()) });
      await client.query("UPDATE team_provisioning_jobs SET completed_phases=ARRAY['team','tools']::text[],phase='workspace',updated_at=now() WHERE org_id=$1::uuid", [orgId]);
      return orgId;
    });
    await startTeamProvisioning(id, session.user.id);
    return Response.json({ id, workspaceReady: true, provisioning: true }, { status: 201 });
  } catch (error) {
    // Deploys do not run migrations. Until 0672 is applied the statement cannot
    // be stored, so the claim is refused (and rolled back) with a plain reason
    // rather than a raw `relation ... does not exist`.
    if ((error as { code?: unknown } | null)?.code === "42P01") {
      return Response.json(
        {
          error: "Claiming a team is paused on this server until a database update is applied.",
          setupRequired: true,
        },
        { status: 503 },
      );
    }
    if ((error as { detail?: unknown } | null)?.detail === "vantage:team_banned") {
      return Response.json({ error: `Team ${teamNumber} can't join Vantage.` }, { status: 403 });
    }
    if ((error as { detail?: unknown } | null)?.detail === "vantage:team_exists") {
      return Response.json(
        { error: `Team ${teamNumber} is already on Vantage. Ask its owners for an invite, or use the team's join code.` },
        { status: 409 },
      );
    }
    const message = publicErrorMessage(error, "Could not claim team");
    return Response.json({ error: message }, { status: 400 });
  }
}
