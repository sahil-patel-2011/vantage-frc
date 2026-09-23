import { withRls } from "@vantage/db";
import { describeGoogleError } from "../../../../../lib/google-sheets/google-api";
import { openAppsScriptBridge } from "../../../../../lib/google-sheets/run-google";
import { mirrorFailJson } from "../../../../../lib/google-sheets/route-helpers";
import {
  type DriveMediaListing,
  driveFolderIdFrom,
  listDriveMedia,
  setUpDriveMedia,
  testDriveMedia,
} from "../../../../../lib/google-drive/drive-media";
import { HttpError, isUuid, requireWorkbookManager, requireWorkbookViewer, roleCanManageWorkbook } from "../../../../../lib/microsoft/authz";
import { json, requireUser } from "../../../../../lib/microsoft/route-helpers";
import { createRateLimiter, rateLimitedResponse } from "../../../../../lib/rate-limit";

export const maxDuration = 60;

/* Setup and tests are one signed call each; a few a minute covers any real use. */
const actionLimiter = createRateLimiter({ limit: 12, windowMs: 5 * 60_000, namespace: "google-drive-media" });

/* Listing reads the whole folder tree through Apps Script (a few seconds). Everyone on a
   team opening Photos shares one read per minute. */
const LIST_TTL_MS = 60_000;
const listCache = new Map<string, { at: number; listing: DriveMediaListing }>();

/**
 * GET /api/integrations/google/drive?orgId=…[&fresh=1] — any team member: the team's photos
 * and videos, tiled from its Google Drive folder.
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    if (!isUuid(orgId)) throw new HttpError(400, "A valid orgId is required.", "invalid_team");

    const opened = await withRls({ userId: user.id, orgId }, async (client) => {
      const role = await requireWorkbookViewer(client, orgId, user.id);
      return { canManage: roleCanManageWorkbook(role), bridge: await openAppsScriptBridge(client, orgId) };
    });
    if (opened.bridge.status !== "ok") {
      return json({ status: "not_connected", canManage: opened.canManage, message: opened.bridge.error });
    }

    const cached = listCache.get(orgId);
    if (cached && url.searchParams.get("fresh") !== "1" && Date.now() - cached.at < LIST_TTL_MS) {
      return json({ status: "ok", canManage: opened.canManage, listing: cached.listing, cachedAt: new Date(cached.at).toISOString() });
    }
    try {
      const listing = await listDriveMedia(opened.bridge.bridge);
      listCache.set(orgId, { at: Date.now(), listing });
      return json({ status: "ok", canManage: opened.canManage, listing, cachedAt: new Date().toISOString() });
    } catch (error) {
      return json({ status: "unavailable", canManage: opened.canManage, message: describeGoogleError(error) });
    }
  } catch (error) {
    return mirrorFailJson(error);
  }
}

/**
 * POST /api/integrations/google/drive — owner/admin.
 *   { orgId, action: "setup", folder?: link or id, shareWithLink?: boolean }
 *   { orgId, action: "test" }
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = (await request.json().catch(() => ({}))) as {
      orgId?: unknown;
      action?: unknown;
      folder?: unknown;
      shareWithLink?: unknown;
    };
    const orgId = body.orgId;
    if (!isUuid(orgId)) throw new HttpError(400, "A valid orgId is required.", "invalid_team");
    if (body.action !== "setup" && body.action !== "test") throw new HttpError(400, "Unknown action.", "bad_action");

    const opened = await withRls({ userId: user.id, orgId }, async (client) => {
      await requireWorkbookManager(client, orgId, user.id);
      const team = await client.query<{ name: string }>(`SELECT name FROM organizations WHERE id = $1::uuid`, [orgId]);
      return { team: team.rows[0]?.name ?? "", bridge: await openAppsScriptBridge(client, orgId) };
    });
    if (!(await actionLimiter.allow(orgId))) return rateLimitedResponse("A lot of Drive requests just now. Wait a minute and try again.");
    if (opened.bridge.status !== "ok") return json({ error: opened.bridge.error, code: opened.bridge.status }, 409);
    const bridge = opened.bridge.bridge;

    if (body.action === "test") {
      try {
        return json({ ok: true, ...(await testDriveMedia(bridge)) });
      } catch (error) {
        return json({ ok: true, passed: false, steps: [{ step: "Run the Drive test", ok: false, detail: describeGoogleError(error) }] });
      }
    }

    const rootId = driveFolderIdFrom(body.folder);
    if (rootId === null) return json({ error: "That doesn't look like a Google Drive folder link.", code: "bad_folder" }, 400);
    try {
      const result = await setUpDriveMedia(bridge, {
        team: opened.team,
        rootId,
        shareWithLink: typeof body.shareWithLink === "boolean" ? body.shareWithLink : null,
      });
      listCache.delete(orgId);
      return json({ ok: true, ...result });
    } catch (error) {
      return json({ error: describeGoogleError(error), code: "drive_failed" }, 502);
    }
  } catch (error) {
    return mirrorFailJson(error);
  }
}
