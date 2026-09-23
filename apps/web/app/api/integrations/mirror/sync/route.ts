import { withRls } from "@vantage/db";
import { mirrorFailJson } from "../../../../../lib/google-sheets/route-helpers";
import { HttpError, isUuid, requireWorkbookManager } from "../../../../../lib/microsoft/authz";
import { json, readOrgIdFromRequest, requireUser } from "../../../../../lib/microsoft/route-helpers";
import { syncMirror } from "../../../../../lib/mirror/mirror-sync";
import { connectedTargetDefs, readCopyStates } from "../../../../../lib/mirror/mirror-targets";
import { createRateLimiter, rateLimitedResponse } from "../../../../../lib/rate-limit";

export const maxDuration = 120;

/*
  One press writes the same tables to both copies. Both providers throttle per app, so a
  team gets six syncs per ten minutes — the same budget as the Excel-only sync — and the
  nightly run keeps both copies at most a day old without anybody pressing anything.
*/
const syncLimiter = createRateLimiter({ limit: 6, windowMs: 10 * 60_000, namespace: "spreadsheet-mirror-sync" });

/** POST /api/integrations/mirror/sync  { orgId }  — owner/admin. */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const orgId = await readOrgIdFromRequest(request);
    if (!isUuid(orgId)) throw new HttpError(400, "A valid orgId is required.", "invalid_team");

    // Role first, so the rate limit is not a way to probe other teams.
    await withRls({ userId: user.id, orgId }, (client) => requireWorkbookManager(client, orgId, user.id));
    if (!(await syncLimiter.allow(orgId))) {
      return rateLimitedResponse("This team has synced several times in the last few minutes. Wait a little and try again.");
    }

    const result = await withRls({ userId: user.id, orgId }, async (client) => {
      await requireWorkbookManager(client, orgId, user.id);
      const states = await readCopyStates(client, orgId);
      if (!states.migrated) return { status: "not_migrated" as const };
      const targets = connectedTargetDefs(client, orgId, states.copies);
      if (!targets.length) return { status: "not_connected" as const };
      return syncMirror(client, orgId, { targets, userId: user.id });
    });

    switch (result.status) {
      case "not_migrated":
        return json({ error: "The spreadsheet mirror needs a database update first.", code: "not_migrated", setupRequired: true }, 503);
      case "not_connected":
        return json({ error: "Connect Google Sheets or Microsoft Excel first.", code: "not_connected" }, 409);
      case "busy":
        return json({ error: "A sync for this team is already running.", code: "busy" }, 409);
      default: {
        const written = result.copies.filter((copy) => copy.status === "succeeded");
        return json({
          ok: written.length > 0,
          hash: result.hash,
          identical: written.length === result.copies.length && result.copies.length > 1,
          copies: result.copies,
        });
      }
    }
  } catch (error) {
    return mirrorFailJson(error);
  }
}
