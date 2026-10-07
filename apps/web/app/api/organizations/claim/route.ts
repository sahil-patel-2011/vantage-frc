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
import { z } from "zod";
import { parseSecureJson, securityErrorResponse } from "../../../../lib/security/request";

const claimRequest = z.object({
  name: z.string().trim().min(1).max(160),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  teamNumber: z.number().int().min(1).max(99999),
  termsAccepted: z.boolean().optional(), privacyAccepted: z.boolean().optional(),
  authorizationAcknowledged: z.unknown().optional(), attestationVersion: z.unknown().optional(),
  joinPin: z.string().regex(/^\d{6}$/).optional(),
});

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Your session ended. Sign in again." }, { status: 401, headers: { "Cache-Control": "private, no-store" } });

  let body: z.infer<typeof claimRequest>;
  try {
    body = await parseSecureJson(request, claimRequest);
  } catch (error) {
    return securityErrorResponse(error, "Check your team name, number and join code.");
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
      await setTeamJoinCode(client, orgId, body.joinPin?.trim() || undefined);
      await client.query("UPDATE team_provisioning_jobs SET completed_phases=ARRAY['team','tools']::text[],phase='workspace',updated_at=now() WHERE org_id=$1::uuid", [orgId]);
      return orgId;
    });
    const provisioning = await startTeamProvisioning(id, session.user.id);
    return Response.json({ id, workspaceReady: true, provisioning }, { status: 201 });
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
    const message = publicErrorMessage(error, "Could not claim team");
    return Response.json({ error: message }, { status: 400 });
  }
}
