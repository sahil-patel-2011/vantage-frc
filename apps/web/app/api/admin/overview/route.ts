import { NO_STORE, adminErrorResponse, asPlatformAdmin } from "../../../../lib/admin/admin-route";
import { loadAdminOverview } from "../../../../lib/admin/overview";

/** The Platform admin Overview: anything wrong, anything waiting. Platform admins only (404). */
export async function GET() {
  try {
    const overview = await asPlatformAdmin((client) => loadAdminOverview(client));
    return Response.json(overview, { headers: NO_STORE });
  } catch (error) {
    return adminErrorResponse(error, "The overview didn't load. Try again.");
  }
}
