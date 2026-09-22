import { withRls } from "@vantage/db";
import { HttpError, isUuid, requireWorkbookManager } from "../../../../../../lib/microsoft/authz";
import { MICROSOFT_SETUP_MESSAGE, getMicrosoftConfig } from "../../../../../../lib/microsoft/graph";
import { failJson, json, readOrgIdFromRequest, requireUser } from "../../../../../../lib/microsoft/route-helpers";
import { IMPORT_NOT_MIGRATED_MESSAGE, runImportPreview } from "../../../../../../lib/microsoft/run-import";
import { createRateLimiter, rateLimitedResponse } from "../../../../../../lib/rate-limit";
import { importFailureResponse } from "../responses";

export const maxDuration = 60;

/*
  A preview reads three tables from the workbook (a handful of Graph calls) and writes
  nothing. Ten per team per ten minutes leaves room to fix a cell and look again.
*/
const previewLimiter = createRateLimiter({ limit: 10, windowMs: 10 * 60_000, namespace: "microsoft-workbook-import-preview" });

/**
 * POST /api/integrations/microsoft/import/preview  { orgId }  — owner/admin.
 *
 * What would change if the team imported its workbook now: changes, conflicts, read-only
 * edits and rows that cannot be matched. Stateless: nothing is stored, and apply re-reads.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const orgId = await readOrgIdFromRequest(request);
    if (!isUuid(orgId)) throw new HttpError(400, "A valid orgId is required.", "invalid_team");

    const config = getMicrosoftConfig();
    if (!config) return json({ error: MICROSOFT_SETUP_MESSAGE, code: "setup_required", setupRequired: true }, 503);

    // Role first, so the rate limit is not a way to probe other teams.
    await withRls({ userId: user.id, orgId }, (client) => requireWorkbookManager(client, orgId, user.id));
    if (!(await previewLimiter.allow(orgId))) {
      return rateLimitedResponse("This team has checked the workbook several times in the last few minutes. Wait a little and try again.");
    }

    const result = await withRls({ userId: user.id, orgId }, async (client) => {
      await requireWorkbookManager(client, orgId, user.id);
      return runImportPreview(client, { orgId, config });
    });

    if (result.status === "ok") return json({ ok: true, preview: result.preview });
    if (result.status === "not_migrated") {
      return json({ error: IMPORT_NOT_MIGRATED_MESSAGE, code: "not_migrated", setupRequired: true }, 503);
    }
    return importFailureResponse(result);
  } catch (error) {
    return failJson(error);
  }
}
