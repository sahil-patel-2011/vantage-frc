import { withRls } from "@vantage/db";
import { HttpError, isUuid, requireWorkbookManager } from "../../../../../../lib/microsoft/authz";
import { MICROSOFT_SETUP_MESSAGE, getMicrosoftConfig } from "../../../../../../lib/microsoft/graph";
import { failJson, json, requireUser } from "../../../../../../lib/microsoft/route-helpers";
import { IMPORT_NOT_MIGRATED_MESSAGE, runImportApply } from "../../../../../../lib/microsoft/run-import";
import { createRateLimiter, rateLimitedResponse } from "../../../../../../lib/rate-limit";
import { importFailureResponse } from "../responses";

export const maxDuration = 60;

/** Same budget as Sync now: an apply re-reads the workbook before it writes. */
const applyLimiter = createRateLimiter({ limit: 6, windowMs: 10 * 60_000, namespace: "microsoft-workbook-import-apply" });

const MAX_CHANGE_IDS = 5000;

/**
 * POST /api/integrations/microsoft/import/apply  { orgId, changeIds: string[] }  — owner/admin.
 *
 * Re-reads the workbook, re-diffs against Postgres, and writes only the confirmed changes
 * that still match the preview exactly. Anything that moved on becomes a conflict.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = (await request.json().catch(() => ({}))) as { orgId?: unknown; changeIds?: unknown };
    const orgId = body.orgId;
    if (!isUuid(orgId)) throw new HttpError(400, "A valid orgId is required.", "invalid_team");
    const changeIds = Array.isArray(body.changeIds)
      ? [...new Set(body.changeIds.filter((id): id is string => typeof id === "string" && /^[0-9a-f]{24}$/.test(id)))]
      : [];
    if (changeIds.length === 0) throw new HttpError(400, "Choose at least one change to apply.", "no_changes");
    if (changeIds.length > MAX_CHANGE_IDS) {
      throw new HttpError(400, `Apply at most ${MAX_CHANGE_IDS.toLocaleString("en-US")} changes at a time.`, "too_many_changes");
    }

    const config = getMicrosoftConfig();
    if (!config) return json({ error: MICROSOFT_SETUP_MESSAGE, code: "setup_required", setupRequired: true }, 503);

    await withRls({ userId: user.id, orgId }, (client) => requireWorkbookManager(client, orgId, user.id));
    if (!(await applyLimiter.allow(orgId))) {
      return rateLimitedResponse("This team has imported several times in the last few minutes. Wait a little and try again.");
    }

    const result = await withRls({ userId: user.id, orgId }, async (client) => {
      await requireWorkbookManager(client, orgId, user.id);
      return runImportApply(client, { orgId, userId: user.id, changeIds, config });
    });

    switch (result.status) {
      case "not_migrated":
        return json({ error: IMPORT_NOT_MIGRATED_MESSAGE, code: "not_migrated", setupRequired: true }, 503);
      case "busy":
        return json({ error: "A sync or import for this team is already running. Try again in a moment.", code: "busy" }, 409);
      case "failed":
        return json({ error: result.error, code: "failed", runId: result.runId }, 502);
      case "applied":
      case "nothing_applied":
        return json({
          ok: true,
          status: result.status,
          runId: result.runId,
          applied: result.applied,
          conflicts: result.conflicts,
          skipped: result.skipped,
          stale: result.stale,
          lateConflicts: result.lateConflicts,
        });
      default:
        return importFailureResponse(result);
    }
  } catch (error) {
    return failJson(error);
  }
}
