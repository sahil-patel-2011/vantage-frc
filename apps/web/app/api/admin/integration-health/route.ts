import { assertPlatformAdmin, auth, platformAdminDeniedResponse } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { loadIntegrationHealth } from "../../../../lib/admin/load-integration-health";

/**
 * Platform-admin-only integration health aggregator. GET only — this surface never
 * mutates anything and never triggers a live network call to an external provider.
 * Bounded test actions (TBA test, provider-key test, Base44 health test, etc.) already
 * exist on their owning admin routes (`/api/admin/data-connectors`, `/api/admin/models`);
 * this route only reads already-persisted, already-redacted signals plus env presence.
 */
export async function GET() {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new Error("Authentication required");
    const payload = await withRls({ userId: session.user.id }, async (client) => {
      await assertPlatformAdmin(client);
      return loadIntegrationHealth(client);
    });
    const response = Response.json(payload);
    response.headers.set("cache-control", "private, no-store, max-age=0");
    return response;
  } catch (error) {
    return platformAdminDeniedResponse(error);
  }
}
