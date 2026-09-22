import { withRls } from "@vantage/db";
import { HttpError, isUuid, requireWorkbookManager } from "../../../../../lib/microsoft/authz";
import { deleteConnection } from "../../../../../lib/microsoft/connection-store";
import { failJson, json, readOrgIdFromRequest, requireUser } from "../../../../../lib/microsoft/route-helpers";

/**
 * DELETE /api/integrations/microsoft/disconnect  { orgId }  — owner/admin.
 *
 * Deletes the stored (encrypted) refresh token and the link to the workbook. The workbook
 * itself stays in the Microsoft account's OneDrive — it is the team's file. Sync history
 * rows are kept. Revoking Vantage's consent on the Microsoft side is done at
 * https://account.microsoft.com/privacy/app-access (personal) or by the tenant admin.
 */
export async function DELETE(request: Request) {
  try {
    const user = await requireUser();
    const orgId = await readOrgIdFromRequest(request);
    if (!isUuid(orgId)) throw new HttpError(400, "A valid orgId is required.", "invalid_team");
    const removed = await withRls({ userId: user.id, orgId }, async (client) => {
      await requireWorkbookManager(client, orgId, user.id);
      return deleteConnection(client, orgId);
    });
    return json({ ok: true, removed });
  } catch (error) {
    return failJson(error);
  }
}
