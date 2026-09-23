import { withRls } from "@vantage/db";
import { deleteGoogleConnection } from "../../../../../lib/google-sheets/connection-store";
import { mirrorFailJson } from "../../../../../lib/google-sheets/route-helpers";
import { HttpError, isUuid, requireWorkbookManager } from "../../../../../lib/microsoft/authz";
import { json, readOrgIdFromRequest, requireUser } from "../../../../../lib/microsoft/route-helpers";

/**
 * DELETE /api/integrations/google/disconnect  { orgId }  — owner/admin.
 *
 * Deletes the stored (encrypted) refresh token and the link to the spreadsheet. The
 * spreadsheet stays in the owner's Google Drive — it is the team's file. Revoking Vantage's
 * access on Google's side is done at https://myaccount.google.com/permissions.
 */
export async function DELETE(request: Request) {
  try {
    const user = await requireUser();
    const orgId = await readOrgIdFromRequest(request);
    if (!isUuid(orgId)) throw new HttpError(400, "A valid orgId is required.", "invalid_team");
    const removed = await withRls({ userId: user.id, orgId }, async (client) => {
      await requireWorkbookManager(client, orgId, user.id);
      return deleteGoogleConnection(client, orgId);
    });
    return json({ ok: true, removed });
  } catch (error) {
    return mirrorFailJson(error);
  }
}
