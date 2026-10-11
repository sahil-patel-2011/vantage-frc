import { auth, latestTeamRemoval } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { publicErrorMessage } from "../../../../lib/security/public-error";

/**
 * GET /api/onboarding/removal — "You were removed from Team 9301", for the no-team screen.
 *
 * A member taken off a team landed on "Profile saved. Join your team next." with no word of
 * why (QA A3-15). The owner's removal writes the person a notice (0721); this reads the newest
 * one from the last 60 days for a team they are not back on. Their own inbox only (RLS), and
 * under /api/onboarding so it answers while they have no team.
 */
export async function GET() {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return Response.json({ removal: null }, { status: 401, headers: { "cache-control": "private, no-store" } });
    const removal = await withRls({ userId: session.user.id }, (client) => latestTeamRemoval(client, session.user.id));
    return Response.json({ removal }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    // Never blocks the screen: without the notice it reads as before.
    return Response.json(
      { removal: null, error: publicErrorMessage(error, "Couldn't check your team history.") },
      { headers: { "cache-control": "private, no-store" } },
    );
  }
}
