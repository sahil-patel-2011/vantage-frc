import { isPlatformAdmin } from "@vantage/core";
import { withRls } from "@vantage/db";
import { aiKeysEncryptionStatus } from "../../../../../lib/ai-keys/kms-status";
import { googleSheetsSetupStatus } from "../../../../../lib/google-sheets/google-api";
import { MIRROR_NOT_MIGRATED_MESSAGE } from "../../../../../lib/google-sheets/connection-store";
import { mirrorFailJson } from "../../../../../lib/google-sheets/route-helpers";
import { HttpError, isUuid, requireWorkbookViewer, roleCanManageWorkbook } from "../../../../../lib/microsoft/authz";
import { microsoftSetupStatus } from "../../../../../lib/microsoft/graph";
import { json, requireUser } from "../../../../../lib/microsoft/route-helpers";
import { summarizeMirror } from "../../../../../lib/mirror/mirror-status";
import { readCopyStates } from "../../../../../lib/mirror/mirror-targets";

/**
 * GET /api/integrations/mirror/status?orgId=…  — any member of the team.
 *
 * Both copies side by side: connected or not, last sync, the content hash each holds, and
 * a summary of whether they match. Deployment configuration (missing env, the Google
 * callback URL to register) is only returned to owners and admins, who can act on it.
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const orgId = new URL(request.url).searchParams.get("orgId");
    if (!isUuid(orgId)) throw new HttpError(400, "A valid orgId is required.", "invalid_team");

    const data = await withRls({ userId: user.id, orgId }, async (client) => {
      const role = await requireWorkbookViewer(client, orgId, user.id);
      return {
        canManage: roleCanManageWorkbook(role),
        platformAdmin: await isPlatformAdmin(client),
        states: await readCopyStates(client, orgId),
      };
    });

    const google = googleSheetsSetupStatus();
    const microsoft = microsoftSetupStatus();
    const encryption = aiKeysEncryptionStatus();
    // Excel appears only once this deployment can offer it (or a team already linked it);
    // until then a team sees one Google copy, not a card nagging about the other.
    const copies = data.states.copies.filter(
      (copy) => copy.copy !== "excel" || microsoft.configured || copy.connected || data.platformAdmin,
    );
    const summary = summarizeMirror(copies, new Date());

    return json({
      migrated: data.states.migrated,
      setupMessage: !data.states.migrated ? MIRROR_NOT_MIGRATED_MESSAGE : encryption.ok ? null : encryption.message,
      canManage: data.canManage,
      summary,
      platformAdmin: data.platformAdmin,
      copies: copies.map((copy) => ({
        copy: copy.copy,
        connected: copy.connected,
        lastSyncAt: copy.lastSyncAt,
        lastSyncHash: copy.lastSyncHash,
        lastReadAt: copy.lastReadAt,
        throttledUntil: copy.throttledUntil,
        lastError: copy.lastError,
        fileUrl: copy.fileUrl,
        fileName: copy.fileName,
        account: copy.account,
        viaAppsScript: copy.viaAppsScript,
      })),
      providers: {
        google: {
          configured: google.configured,
          oauthOffered: google.oauthOffered,
          message: google.message,
          missingEnv: data.platformAdmin ? google.missingEnv : [],
          callbackUrl: data.platformAdmin ? google.callbackUrl : null,
        },
        excel: {
          configured: microsoft.configured,
          message: microsoft.message,
          missingEnv: data.platformAdmin ? microsoft.missingEnv : [],
        },
      },
    });
  } catch (error) {
    return mirrorFailJson(error);
  }
}
