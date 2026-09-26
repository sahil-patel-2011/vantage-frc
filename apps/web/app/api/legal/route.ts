import { auth, assertLegalAccepted, legalUpdateRequired, LEGAL_DOC_VERSION, recordLegalAcceptance } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { publicErrorMessage } from "../../../lib/security/public-error";

type ProfileLegal = {
  termsAcceptedAt: string | null;
  privacyAcceptedAt: string | null;
  termsVersion: string | null;
  privacyVersion: string | null;
};

/** Whether the signed-in person accepted the current Terms and Privacy Policy. */
export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ updateRequired: false }, { status: 401 });
  try {
    const row = await withRls({ userId: session.user.id }, async (client) =>
      (
        await client.query<ProfileLegal>(
          `SELECT terms_accepted_at::text AS "termsAcceptedAt", privacy_accepted_at::text AS "privacyAcceptedAt",
                  terms_version AS "termsVersion", privacy_version AS "privacyVersion"
             FROM profiles WHERE user_id = $1::uuid`,
          [session.user.id],
        )
      ).rows[0] ?? null,
    );
    return Response.json(
      { updateRequired: row ? legalUpdateRequired(row) : false, version: LEGAL_DOC_VERSION },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch {
    // Never block the app on this check.
    return Response.json({ updateRequired: false });
  }
}

/** Records acceptance of the current version: both boxes, sent as true, or nothing is written. */
export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Your session ended. Sign in again." }, { status: 401 });
  try {
    const body = (await request.json().catch(() => ({}))) as { termsAccepted?: unknown; privacyAccepted?: unknown };
    assertLegalAccepted({ termsAccepted: body.termsAccepted, privacyAccepted: body.privacyAccepted });
    await withRls({ userId: session.user.id }, (client) => recordLegalAcceptance(client, session.user.id));
    return Response.json({ ok: true, version: LEGAL_DOC_VERSION });
  } catch (error) {
    return Response.json({ error: publicErrorMessage(error, "Couldn't save that. Try again.") }, { status: 400 });
  }
}
