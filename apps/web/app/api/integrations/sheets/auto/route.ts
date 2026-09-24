import { withRls } from "@vantage/db";
import { after } from "next/server";
import { sheetsHubBridge, syncTeamToHub } from "../../../../../lib/google-sheets/sheets-hub";
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
 * team's longest-standing owner (then admin). The spreadsheet holds what an owner could
 * export; a scout's ping only decides *when* it refreshes, and gets nothing back.
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

async function runAutoSync(orgId: string, runnerId: string): Promise<void> {
  // The team's own connected copies (Google Apps Script / Sheets API, Excel).
  await withRls({ userId: runnerId, orgId }, async (client) => {
    await requireWorkbookManager(client, orgId, runnerId);
    const states = await readCopyStates(client, orgId);
    if (!states.migrated) return;
    const targets = connectedTargetDefs(client, orgId, states.copies);
    if (!targets.length) return;
    const lastHashes = Object.fromEntries(states.copies.map((copy) => [copy.copy, copy.lastSyncHash]));
    await syncMirror(client, orgId, { targets, userId: runnerId, lastHashes });
  }).catch(() => undefined);

  // The team's sheet in the platform's VantageFRC folder, when the hub is configured.
  if (sheetsHubBridge()) {
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
    after(() => runAutoSync(orgId, runnerId));
    return json({ queued: true }, 202);
  } catch (error) {
    return failJson(error);
  }
}

/** GET /api/integrations/sheets/auto?orgId=…  — owner/admin: the team's hub sheet, made if missing. */
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const orgId = new URL(request.url).searchParams.get("orgId");
    if (!isUuid(orgId)) throw new HttpError(400, "A valid orgId is required.", "invalid_team");
    const bridge = sheetsHubBridge();
    if (!bridge) return json({ configured: false });
    const result = await withRls({ userId: user.id, orgId }, async (client) => {
      await requireWorkbookManager(client, orgId, user.id);
      return syncTeamToHub(client, orgId, { bridge });
    });
    if (result.status === "not_configured") return json({ configured: false });
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
