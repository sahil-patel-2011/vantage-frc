import { assertPlatformAdmin, auth, platformAdminDeniedResponse } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { APPS_SCRIPT_HUB_VERSION, APPS_SCRIPT_VERSION, appsScriptSource, isAppsScriptSecret, isAppsScriptUrl } from "../../../../lib/google-sheets/apps-script-source";
import { describeGoogleError } from "../../../../lib/google-sheets/google-api";
import { sheetsHubBridge, sheetsHubConfig } from "../../../../lib/google-sheets/sheets-hub";

/**
 * GET /api/admin/sheets-hub — platform admin only.
 *
 * Where the team-sheets hub stands: whether the two env vars are set, whether the script
 * answers (and is new enough for hub mode), and the script to paste — built with the
 * server's secret, so it is shown only here, to a platform admin.
 */
export async function GET() {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new Error("Authentication required");
    await withRls({ userId: session.user.id }, (client) => assertPlatformAdmin(client));

    const rawUrl = process.env.VANTAGE_SHEETS_HUB_URL?.trim() ?? "";
    const rawSecret = process.env.VANTAGE_SHEETS_HUB_SECRET?.trim().toLowerCase() ?? "";
    const urlSet = isAppsScriptUrl(rawUrl);
    const secretSet = isAppsScriptSecret(rawSecret);
    let check: {
      ok: boolean;
      version: number | null;
      hub: boolean;
      folderUrl: string | null;
      error: string | null;
      /** Working, but an older script: the new one lays each team spreadsheet out as a database. */
      updateAvailable: boolean;
    } | null = null;

    const config = sheetsHubConfig();
    const bridge = sheetsHubBridge(config);
    if (bridge) {
      try {
        const ping = await bridge.ping({ hub: true });
        const tooOld = ping.version < APPS_SCRIPT_HUB_VERSION;
        check = {
          ok: ping.hub && !tooOld,
          version: ping.version,
          hub: ping.hub,
          folderUrl: ping.hub ? ping.url : null,
          updateAvailable: ping.version < APPS_SCRIPT_VERSION,
          error: tooOld
            ? "The script is an older version. Paste the script below over it and deploy a new version."
            : !ping.hub
              ? "That script lives inside a spreadsheet. Deploy it as its own project at script.google.com instead."
              : null,
        };
      } catch (error) {
        check = { ok: false, version: null, hub: false, folderUrl: null, updateAvailable: false, error: describeGoogleError(error) };
      }
    }

    const response = Response.json({
      urlSet,
      secretSet,
      configured: Boolean(config),
      check,
      script: secretSet ? appsScriptSource(rawSecret) : null,
    });
    response.headers.set("cache-control", "private, no-store, max-age=0");
    return response;
  } catch (error) {
    return platformAdminDeniedResponse(error);
  }
}
