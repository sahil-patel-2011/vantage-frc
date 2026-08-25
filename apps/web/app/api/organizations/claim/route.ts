import {
  assertLegalAccepted,
  auth,
  claimFrcTeamWorkspace,
  recordLegalAcceptance,
} from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: {
    name?: string;
    slug?: string;
    teamNumber?: number;
    termsAccepted?: boolean;
    privacyAccepted?: boolean;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.name || !body.slug || !body.teamNumber) {
    return Response.json({ error: "name, slug, and teamNumber are required" }, { status: 400 });
  }

  try {
    // Creating a workspace is an entry point: the server re-validates both
    // consents before anything is written. A client checkbox is not consent.
    assertLegalAccepted({
      termsAccepted: body.termsAccepted,
      privacyAccepted: body.privacyAccepted,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Consent is required.";
    return Response.json({ error: message }, { status: 400 });
  }

  try {
    // withRls runs the callback inside one BEGIN/COMMIT, so the acceptance row
    // and the workspace are committed together or not at all.
    const id = await withRls({ userId: session.user.id }, async (client) => {
      await recordLegalAcceptance(client, session.user.id);
      return claimFrcTeamWorkspace(client, session.user.id, {
        name: body.name!,
        slug: body.slug!,
        teamNumber: Number(body.teamNumber),
      });
    });
    return Response.json({ id }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not claim team";
    return Response.json({ error: message }, { status: 400 });
  }
}
