import { withRls } from "@vantage/db";
import { isPlatformAdmin } from "@vantage/core";
import { after } from "next/server";
import { loadSheetsHubBridge, syncTeamToHub } from "../../../../../lib/google-sheets/sheets-hub";
import { HttpError, isUuid, readOrgRole, requireWorkbookManager, roleCanManageWorkbook } from "../../../../../lib/microsoft/authz";
import { failJson, json, readOrgIdFromRequest, requireUser } from "../../../../../lib/microsoft/route-helpers";
import { syncMirror } from "../../../../../lib/mirror/mirror-sync";
import { connectedTargetDefs, readCopyStates } from "../../../../../lib/mirror/mirror-targets";
import { createRateLimiter } from "../../../../../lib/rate-limit";

export const maxDuration = 120;

/*
  Automatic spreadsheet sync. The app shell pings this while someone has Vantage open, so a
  team's Google Sheet (its own, and its sheet in the VantageFRC hub) follows what people do
  without anybody pressing Sync. Each ping is cheap when nothing changed: the tables are
  hashed and a copy already at that hash is not rewritten.

  At most one run per team every two minutes, whoever triggers it.
*/
const autoLimiter = createRateLimiter({ limit: 1, windowMs: 2 * 60_000, namespace: "sheets-auto-sync" });

/**
 * The person the sync runs as: the caller when they are an owner or admin, otherwise the
 * team's longest-standing owner (then admin). A deliberate, narrow exception to "withRls runs
 * as the session user", matching the nightly scheduled mirror: the spreadsheet holds what an
 * owner could export, the caller gets nothing back, and the run is recorded as automatic.
 * A scout's ping only decides *when* it refreshes.
 */
async function syncRunner(orgId: string, userId: string): Promise<string> {
  return withRls({ userId, orgId }, async (client) => {
    const role = await readOrgRole(client, orgId, userId);
    if (!role) throw new HttpError(403, "You are not a member of this team.", "not_member");
    if (roleCanManageWorkbook(role)) return userId;
    const owner = (
      await client.query<{ userId: string }>(
        `SELECT user_id::text AS "userId" FROM memberships
          WHERE org_id = $1::uuid AND role::text IN ('owner', 'admin')
          ORDER BY (role::text = 'owner') DESC, created_at ASC
          LIMIT 1`,
        [orgId],
      )
    ).rows[0];
    if (!owner) throw new HttpError(409, "This team has no owner to sync as.", "no_owner");
    return owner.userId;
  });
}

async function runAutoSync(orgId: string, runnerId: string, callerIsRunner: boolean): Promise<void> {
  // The team's own connected copies (Google Apps Script / Sheets API, Excel).
  await withRls({ userId: runnerId, orgId }, async (client) => {
    await requireWorkbookManager(client, orgId, runnerId);
    const states = await readCopyStates(client, orgId);
    if (!states.migrated) return;
    const targets = connectedTargetDefs(client, orgId, states.copies);
    if (!targets.length) return;
    const lastHashes = Object.fromEntries(states.copies.map((copy) => [copy.copy, copy.lastSyncHash]));
    // started_by names a person only when that person asked; a member's open tab is "automatic".
    await syncMirror(client, orgId, { targets, userId: callerIsRunner ? runnerId : null, lastHashes });
  }).catch(() => undefined);

  // The team's sheet in the platform's VantageFRC folder, when the hub is configured.
  // (syncTeamToHub reads the hub address itself and does nothing when there is none.)
  if (process.env.VANTAGE_SHEETS_HUB_SECRET) {
    await withRls({ userId: runnerId, orgId }, async (client) => {
      await requireWorkbookManager(client, orgId, runnerId);
      await syncTeamToHub(client, orgId);
    }).catch(() => undefined);
  }
}

/** POST /api/integrations/sheets/auto  { orgId }  — any member; returns at once, syncs after. */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const orgId = await readOrgIdFromRequest(request);
    if (!isUuid(orgId)) throw new HttpError(400, "A valid orgId is required.", "invalid_team");
    const runnerId = await syncRunner(orgId, user.id);
    if (!(await autoLimiter.allow(orgId))) return json({ queued: false, reason: "recent" }, 202);
    after(() => runAutoSync(orgId, runnerId, runnerId === user.id));
    return json({ queued: true }, 202);
  } catch (error) {
    return failJson(error);
  }
}

/**
 * GET /api/integrations/sheets/auto?orgId=…  — platform admin only: the team's hub copy, made if
 * missing. Where the platform keeps its copy of team data is hosting plumbing, so teams (owners
 * included) get { configured: false } and nothing is synced on their behalf here.
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const orgId = new URL(request.url).searchParams.get("orgId");
    if (!isUuid(orgId)) throw new HttpError(400, "A valid orgId is required.", "invalid_team");
    const result = await withRls({ userId: user.id, orgId }, async (client) => {
      const bridge = await loadSheetsHubBridge(client);
      if (!bridge) return null;
      if (!(await isPlatformAdmin(client))) return null;
      await requireWorkbookManager(client, orgId, user.id);
      return syncTeamToHub(client, orgId, { bridge });
    });
    if (!result || result.status === "not_configured") return json({ configured: false });
    const book = "book" in result ? result.book : null;
    return json({
      configured: true,
      status: result.status,
      url: book?.url ?? null,
      name: book?.name ?? null,
      lastSyncAt: book?.lastSyncAt ?? null,
      error: "error" in result ? result.error : null,
    });
  } catch (error) {
    return failJson(error);
  }
}
