import { withRls } from "@vantage/db";
import { mirrorFailJson } from "../../../../../lib/google-sheets/route-helpers";
import { HttpError, isUuid, requireWorkbookManager } from "../../../../../lib/microsoft/authz";
import { json, requireUser } from "../../../../../lib/microsoft/route-helpers";
import { describeSkipped, runMirrorImportApply, runMirrorImportPreview } from "../../../../../lib/mirror/mirror-import";
import { createRateLimiter, rateLimitedResponse } from "../../../../../lib/rate-limit";

export const maxDuration = 120;

const importLimiter = createRateLimiter({ limit: 10, windowMs: 10 * 60_000, namespace: "spreadsheet-mirror-import" });

/**
 * POST /api/integrations/mirror/import  — owner/admin.
 *   { orgId, action: "preview" }                  read both copies, merge, show what would change
 *   { orgId, action: "apply", changeIds: [...] }  re-read, re-merge, apply only confirmed changes
 *
 * Reads every copy that is up (least recently read first), so an edit made in either
 * spreadsheet is found. Two different edits to one field are shown as a mirror conflict and
 * never applied.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = (await request.json().catch(() => ({}))) as { orgId?: unknown; action?: unknown; changeIds?: unknown };
    const orgId = body.orgId;
    if (!isUuid(orgId)) throw new HttpError(400, "A valid orgId is required.", "invalid_team");
    const action = body.action === "apply" ? "apply" : "preview";
    const changeIds = Array.isArray(body.changeIds)
      ? body.changeIds.filter((id): id is string => typeof id === "string" && /^[a-f0-9]{24}$/.test(id)).slice(0, 5_000)
      : [];
    if (action === "apply" && changeIds.length === 0) {
      throw new HttpError(400, "Pick at least one change to apply.", "no_changes");
    }

    await withRls({ userId: user.id, orgId }, (client) => requireWorkbookManager(client, orgId, user.id));
    if (!(await importLimiter.allow(orgId))) {
      return rateLimitedResponse("This team has pulled from its spreadsheets several times in the last few minutes. Wait a little.");
    }

    const result = await withRls({ userId: user.id, orgId }, async (client) => {
      await requireWorkbookManager(client, orgId, user.id);
      return action === "apply"
        ? runMirrorImportApply(client, { orgId, userId: user.id, changeIds })
        : runMirrorImportPreview(client, { orgId });
    });

    switch (result.status) {
      case "not_migrated":
        return json({ error: "The spreadsheet mirror needs a database update first.", code: "not_migrated", setupRequired: true }, 503);
      case "not_connected":
        return json({ error: "Connect Google Sheets or Microsoft Excel first.", code: "not_connected" }, 409);
      case "no_copy_available":
        return json(
          { error: describeSkipped(result.skipped) ?? "No copy could be read right now.", code: "no_copy_available", skipped: result.skipped },
          502,
        );
      default:
        return json({ ...result, notice: describeSkipped(result.skipped) });
    }
  } catch (error) {
    return mirrorFailJson(error);
  }
}
