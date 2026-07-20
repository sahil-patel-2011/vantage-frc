import {
  resolveSponsoredPromoForOrg,
  maybeNotifySponsoredPromoExpired,
} from "@vantage/billing";
import { getSponsoredPoolStatus } from "@vantage/agent";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

/**
 * Soft-UI promo status for team 1111 sponsored AI.
 * Never returns API key values — eligibility + endsAt + masked pool status only.
 */
export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  const orgId = new URL(request.url).searchParams.get("orgId") ?? undefined;
  if (!session || !orgId) {
    return Response.json({ error: "Authentication and organization are required" }, { status: 401 });
  }

  try {
    const payload = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const status = await resolveSponsoredPromoForOrg(client, orgId);
      if (!status.eligible && status.reason === "promo_expired") {
        await maybeNotifySponsoredPromoExpired(client, orgId, status);
      }
      const pool = getSponsoredPoolStatus();
      return {
        teamNumber: status.eligible ? status.teamNumber : status.teamNumber,
        eligible: status.eligible,
        endsAt: status.endsAt,
        fundingMode: status.fundingMode,
        reason: status.eligible ? null : status.reason,
        message: status.eligible
          ? `Promotional sponsored AI is active for team ${status.teamNumber} until ${status.endsAt.slice(0, 10)}.`
          : status.message,
        pool: {
          configured: pool.configured,
          models: pool.models,
          balancing: pool.balancing,
          weights: pool.weights,
          degraded: pool.degraded,
          balanced: true,
          note:
            pool.configured.length > 0
              ? `Usage is balanced across ${pool.configured.length} configured provider${pool.configured.length === 1 ? "" : "s"} (weighted round-robin). Keys stay on the server.`
              : "No sponsored provider keys are configured on this deployment.",
        },
      };
    });
    return Response.json(payload);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Sponsored promo status failed" },
      { status: 400 },
    );
  }
}
