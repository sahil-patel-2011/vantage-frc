import { withRls } from "@vantage/db";
import { HttpError, isUuid, requireWorkbookManager } from "../../../../../lib/microsoft/authz";
import { MICROSOFT_SETUP_MESSAGE, getMicrosoftConfig } from "../../../../../lib/microsoft/graph";
import { runWorkbookSync } from "../../../../../lib/microsoft/run-sync";
import { failJson, json, readOrgIdFromRequest, requireUser } from "../../../../../lib/microsoft/route-helpers";
import { createRateLimiter, rateLimitedResponse } from "../../../../../lib/rate-limit";

export const maxDuration = 60;

/*
  Each sync is a few dozen Microsoft Graph calls against one workbook, and Microsoft
  throttles per workbook and per app. Six syncs per team per ten minutes is plenty for a
  person pressing "Sync now" and keeps one team from spending the app's Graph budget.
*/
const syncLimiter = createRateLimiter({ limit: 6, windowMs: 10 * 60_000, namespace: "microsoft-workbook-sync" });

/** POST /api/integrations/microsoft/sync  { orgId }  — owner/admin. */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const orgId = await readOrgIdFromRequest(request);
    if (!isUuid(orgId)) throw new HttpError(400, "A valid orgId is required.", "invalid_team");

    const config = getMicrosoftConfig();
    if (!config) return json({ error: MICROSOFT_SETUP_MESSAGE, code: "setup_required", setupRequired: true }, 503);

    // Role first, so the rate limit is not a way to probe other teams.
    await withRls({ userId: user.id, orgId }, (client) => requireWorkbookManager(client, orgId, user.id));
    if (!(await syncLimiter.allow(orgId))) {
      return rateLimitedResponse("This team has synced several times in the last few minutes. Wait a little and try again.");
    }

    const result = await withRls({ userId: user.id, orgId }, async (client) => {
      await requireWorkbookManager(client, orgId, user.id);
      return runWorkbookSync(client, { orgId, userId: user.id, config });
    });

    switch (result.status) {
      case "not_connected":
        return json({ error: "Connect a Microsoft account first.", code: "not_connected" }, 409);
      case "busy":
        return json({ error: "A sync for this team is already running.", code: "busy" }, 409);
      case "reconnect_required":
      case "encryption_unavailable":
        return json({ error: result.error, code: result.status }, 409);
      case "microsoft_unavailable":
        return json({ error: result.error, code: result.status }, 502);
      default:
        return json({
          ok: result.status !== "failed",
          status: result.status,
          runId: result.runId,
          rowsWritten: result.rowsWritten,
          tablesWritten: result.tablesWritten,
          error: result.error,
        });
    }
  } catch (error) {
    // Includes "not migrated yet" (42P01) → 503 setup_required, via failJson.
    return failJson(error);
  }
}
