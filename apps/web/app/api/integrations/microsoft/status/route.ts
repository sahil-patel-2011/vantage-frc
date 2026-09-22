import { withRls, withSavepointOrThrow } from "@vantage/db";
import { aiKeysEncryptionStatus } from "../../../../../lib/ai-keys/kms-status";
import { HttpError, isUuid, requireWorkbookViewer, roleCanManageWorkbook } from "../../../../../lib/microsoft/authz";
import {
  type ConnectionStatus,
  NOT_MIGRATED_MESSAGE,
  type SyncRunView,
  isMissingRelation,
  listRecentRuns,
  readConnectionStatus,
} from "../../../../../lib/microsoft/connection-store";
import { microsoftSetupStatus } from "../../../../../lib/microsoft/graph";
import { failJson, json, requireUser } from "../../../../../lib/microsoft/route-helpers";

/**
 * GET /api/integrations/microsoft/status?orgId=…  — any member of the team.
 *
 * Returns setup state, the connection's non-secret columns (from the
 * org_microsoft_connection_status view), and — for owners/admins only — the last five
 * sync runs. Never returns a token or ciphertext.
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const orgId = new URL(request.url).searchParams.get("orgId");
    if (!isUuid(orgId)) throw new HttpError(400, "A valid orgId is required.", "invalid_team");

    const setup = microsoftSetupStatus();
    const encryption = aiKeysEncryptionStatus();

    const data = await withRls({ userId: user.id, orgId }, async (client) => {
      const role = await requireWorkbookViewer(client, orgId, user.id);
      const canManage = roleCanManageWorkbook(role);
      let connection: ConnectionStatus | null = null;
      let runs: SyncRunView[] = [];
      let migrated = true;
      try {
        connection = await withSavepointOrThrow(client, () => readConnectionStatus(client, orgId));
        if (canManage) runs = await withSavepointOrThrow(client, () => listRecentRuns(client, orgId, 5));
      } catch (error) {
        if (!isMissingRelation(error)) throw error;
        migrated = false;
      }
      return { canManage, connection, runs, migrated };
    });

    const setupMessage = !data.migrated
      ? NOT_MIGRATED_MESSAGE
      : !setup.configured
        ? setup.message
        : encryption.ok
          ? null
          : encryption.message;

    return json({
      configured: setup.configured && data.migrated && encryption.ok,
      setupMessage,
      // Deployment configuration is only useful to the people who can act on it.
      missingEnv: data.canManage ? setup.missingEnv : [],
      callbackUrl: data.canManage ? setup.callbackUrl : null,
      scopes: setup.scopes,
      canManage: data.canManage,
      connected: Boolean(data.connection),
      connection: data.connection,
      runs: data.runs,
    });
  } catch (error) {
    return failJson(error);
  }
}
