import { assertPlatformAdmin, auth, platformAdminDeniedResponse } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  computeOrgDrilldown,
  computePlatformAnalytics,
} from "../../../../lib/admin-analytics/queries";

// Platform-owner analytics: the ONE legitimate cross-org read surface.
// Gated to platform_admins (assertPlatformAdmin + the count-only SECURITY
// DEFINER functions from migration 0479, which also fail closed). Every number
// is computed from real rows at read time — an empty platform returns honest
// zeros, never demo metrics.

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Migration 0479 not applied yet → honest setup state, not a hard failure. */
function missingAnalyticsSupport(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: string }).code;
  return (
    code === "42883" ||
    /platform_activity_daily|platform_active_members/.test(error.message)
  );
}

async function runAdmin<T>(work: Parameters<typeof withRls<T>>[1]) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Authentication required");
  return withRls({ userId: session.user.id }, async (client) => {
    await assertPlatformAdmin(client);
    return work(client);
  });
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const orgId = url.searchParams.get("org");
    if (orgId != null && !UUID_PATTERN.test(orgId)) {
      return Response.json({ error: "Invalid organization id" }, { status: 400 });
    }
    if (orgId) {
      const drilldown = await runAdmin((client) => computeOrgDrilldown(client, orgId));
      if (!drilldown) return Response.json({ error: "Organization not found" }, { status: 404 });
      return Response.json(drilldown);
    }
    return Response.json(await runAdmin((client) => computePlatformAnalytics(client)));
  } catch (error) {
    if (missingAnalyticsSupport(error)) {
      return Response.json(
        {
          error:
            "Platform analytics needs database migration 0479_platform_analytics. Run npm run db:migrate, then reload.",
        },
        { status: 503 },
      );
    }
    return platformAdminDeniedResponse(error);
  }
}
