// Pit TV: the stored prediction and opponent tendencies for one match (lib/display/match-intel.ts).
//
// Same two access paths as /api/display/stage: a read-only TV token (the SECURITY DEFINER
// get_display_match_intel, migration 0685) or a signed-in member with orgId. Until 0685 is
// applied the token path answers { intel: null } and the TV simply leaves the section out.

import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { getDisplayPool } from "@vantage/db/display";
import { headers } from "next/headers";
import { loadDisplayMatchIntel } from "../../../../lib/display/match-intel";
import { publicErrorMessage } from "../../../../lib/security/public-error";

const MATCH_KEY = /^[0-9]{4}[a-z0-9]{1,16}_[a-z]{1,3}[0-9]{1,3}(m[0-9]{1,3})?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isMissingFunction(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "42883";
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const matchKey = url.searchParams.get("matchKey") ?? "";
    if (!MATCH_KEY.test(matchKey)) return Response.json({ error: "A match is required." }, { status: 400 });

    const token = url.searchParams.get("token");
    if (token) {
      try {
        const result = await getDisplayPool().query<{ intel: unknown }>("SELECT get_display_match_intel($1, $2) AS intel", [token, matchKey]);
        return Response.json({ intel: result.rows[0]?.intel ?? null });
      } catch (error) {
        if (isMissingFunction(error)) return Response.json({ intel: null });
        throw error;
      }
    }

    const session = await auth.api.getSession({ headers: await headers() });
    const orgId = url.searchParams.get("orgId") ?? "";
    if (!session || !UUID.test(orgId)) {
      return Response.json({ error: "Sign in and choose a team first." }, { status: 401 });
    }
    const intel = await withRls({ userId: session.user.id, orgId }, (client) => loadDisplayMatchIntel(client, orgId, matchKey));
    return Response.json({ intel });
  } catch (error) {
    return Response.json({ error: publicErrorMessage(error, "Match notes unavailable") }, { status: 400 });
  }
}
