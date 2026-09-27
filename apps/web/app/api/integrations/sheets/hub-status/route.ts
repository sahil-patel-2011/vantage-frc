import { withRls } from "@vantage/db";
import { isUuid, HttpError, requireWorkbookViewer } from "../../../../../lib/microsoft/authz";
import { failJson, json, requireUser } from "../../../../../lib/microsoft/route-helpers";
import { loadSheetsHubBridge } from "../../../../../lib/google-sheets/sheets-hub";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const orgId = new URL(request.url).searchParams.get("orgId");
    if (!isUuid(orgId)) throw new HttpError(400, "A valid orgId is required.");
    const status = await withRls({ userId: user.id, orgId }, async (client) => {
      await requireWorkbookViewer(client, orgId, user.id);
      const row = (await client.query(`SELECT state,error,last_verified_at::text AS "lastVerifiedAt",retry_after_at::text AS "retryAfterAt",
        (SELECT count(*) FROM jsonb_object_keys(completed_workbooks))::int AS completed,
        GREATEST(0,extract(epoch FROM clock_timestamp()-last_verified_at))::float8 AS "ageSeconds"
        FROM team_readable_sync_jobs WHERE org_id=$1::uuid`, [orgId])).rows[0] ?? null;
      return { configured: Boolean(await loadSheetsHubBridge(client)), job: row };
    });
    return json(status);
  } catch (error) { return failJson(error); }
}
