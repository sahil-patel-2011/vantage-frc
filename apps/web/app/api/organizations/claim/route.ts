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
      return orgId;
    });
    return Response.json({ id }, { status: 201 });
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
