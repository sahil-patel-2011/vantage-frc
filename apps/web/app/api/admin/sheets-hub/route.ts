import { assertPlatformAdmin, auth, platformAdminDeniedResponse } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  APPS_SCRIPT_HUB_VERSION,
  APPS_SCRIPT_VERSION,
  appsScriptSource,
  isAppsScriptSecret,
  isAppsScriptUrl,
} from "../../../../lib/google-sheets/apps-script-source";
import { describeGoogleError } from "../../../../lib/google-sheets/google-api";
import {
  readRegisteredHubUrl,
  sheetsHubBridge,
  sheetsHubConfig,
  verifyHubRegistration,
} from "../../../../lib/google-sheets/sheets-hub";
import { appBaseUrl } from "../../../../lib/microsoft/route-helpers";

type HubCheck = {
  ok: boolean;
  version: number | null;
  hub: boolean;
  folderUrl: string | null;
  error: string | null;
  /** Working, but an older script: the new one lays each team spreadsheet out as a database. */
  updateAvailable: boolean;
};

async function requireAdmin(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Authentication required");
  await withRls({ userId: session.user.id }, (client) => assertPlatformAdmin(client));
  return session.user.id;
}

async function checkHub(url: string | null): Promise<HubCheck | null> {
  const bridge = sheetsHubBridge(sheetsHubConfig(process.env, url));
  if (!bridge) return null;
  try {
    const ping = await bridge.ping({ hub: true });
    const tooOld = ping.version < APPS_SCRIPT_HUB_VERSION;
    return {
      ok: ping.hub && !tooOld,
      version: ping.version,
      hub: ping.hub,
      folderUrl: ping.hub ? ping.url : null,
      updateAvailable: ping.version < APPS_SCRIPT_VERSION,
      error: tooOld
        ? "The script is an older version. Paste the script below over it and deploy a new version."
        : !ping.hub
          ? "The script answered, but not as the team-sheets hub. Paste the script below over it and deploy a new version."
          : null,
    };
  } catch (error) {
    return { ok: false, version: null, hub: false, folderUrl: null, updateAvailable: false, error: describeGoogleError(error) };
  }
}

function noStore(response: Response): Response {
  response.headers.set("cache-control", "private, no-store, max-age=0");
  return response;
}

/**
 * GET /api/admin/sheets-hub — platform admin only.
 *
 * Where the team-sheets hub stands: whether the secret is set, where the web app address came
 * from (the script registered it, or VANTAGE_SHEETS_HUB_URL), whether the script answers, and
 * the script to paste — built with the server's secret and this site's address, so it is shown
 * only here, to a platform admin.
 */
export async function GET(request: Request) {
  try {
    const userId = await requireAdmin();
    const envUrl = process.env.VANTAGE_SHEETS_HUB_URL?.trim() ?? "";
    const rawSecret = process.env.VANTAGE_SHEETS_HUB_SECRET?.trim().toLowerCase() ?? "";
    const secretSet = isAppsScriptSecret(rawSecret);
    const registered = await withRls({ userId }, (client) => readRegisteredHubUrl(client));
    const urlSource = isAppsScriptUrl(envUrl) ? "env" : registered ? "registered" : null;
    const config = sheetsHubConfig(process.env, registered);
    return noStore(
      Response.json({
        urlSet: Boolean(urlSource),
        urlSource,
        secretSet,
        configured: Boolean(config),
        check: await checkHub(registered),
        script: secretSet ? appsScriptSource(rawSecret, { appUrl: appBaseUrl(new URL(request.url)) }) : null,
      }),
    );
  } catch (error) {
    return platformAdminDeniedResponse(error);
  }
}

/**
 * POST /api/admin/sheets-hub  { action: "register", url, ts, sig } — platform admin only.
 *
 * The deployed script's own address, carried here by the admin's browser from the script's
 * "Connect to Vantage" page. Stored only when it is signed with this server's hub secret.
 */
export async function POST(request: Request) {
  try {
    const userId = await requireAdmin();
    const body = (await request.json().catch(() => ({}))) as { action?: unknown; url?: unknown; ts?: unknown; sig?: unknown };
    if (body.action !== "register") return noStore(Response.json({ error: "Unknown action." }, { status: 400 }));
    const verified = verifyHubRegistration(body, process.env.VANTAGE_SHEETS_HUB_SECRET);
    if (!verified.ok) return noStore(Response.json({ error: verified.error }, { status: 400 }));
    await withRls({ userId }, async (client) => {
      await client.query(
        `INSERT INTO platform_sheets_hub (id, url, registered_by, registered_at)
         VALUES (1, $1::text, $2::uuid, now())
         ON CONFLICT (id) DO UPDATE SET url = EXCLUDED.url, registered_by = EXCLUDED.registered_by, registered_at = now()`,
        [verified.url, userId],
      );
    });
    const check = await checkHub(verified.url);
    return noStore(Response.json({ ok: true, url: verified.url, check }));
  } catch (error) {
    return platformAdminDeniedResponse(error);
  }
}
