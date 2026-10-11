import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { readTeamCreditGifts, teamCreditGiftLine } from "@vantage/billing";
import { headers } from "next/headers";
import { isMissingSchema, NO_STORE, UUID_PATTERN } from "../../../lib/admin/admin-route";

/**
 * A team's free AI credit from Vantage, for anyone on the team: how much was given, what is
 * used, by which model. Never the operator's key. Someone who is not on the team gets the same
 * empty answer as a team with no gift (ai_credit_gift_summary returns nothing to them).
 */
export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Sign in again to continue." }, { status: 401, headers: NO_STORE });
  const orgId = new URL(request.url).searchParams.get("orgId") ?? "";
  if (!UUID_PATTERN.test(orgId)) return Response.json({ error: "Choose a team." }, { status: 400, headers: NO_STORE });
  try {
    const summary = await withRls({ userId: session.user.id, orgId }, (client) => readTeamCreditGifts(client, orgId));
    const live = summary.gifts.filter((gift) => gift.active);
    return Response.json(
      {
        state: live.length ? "active" : "none",
        line: live.length ? teamCreditGiftLine(summary) : null,
        usedUp: live.length > 0 && live.every((gift) => gift.usedUp),
        ...summary,
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    // Before migration 0727 there are no gifts to show; that is not an error for a team.
    if (isMissingSchema(error)) {
      return Response.json(
        { state: "none", line: null, usedUp: false, gifts: [], totalUsd: 0, usedUsd: 0, remainingUsd: 0, byModel: [] },
        { headers: NO_STORE },
      );
    }
    return Response.json({ error: "Your AI credit didn't load. Try again." }, { status: 500, headers: NO_STORE });
  }
}
