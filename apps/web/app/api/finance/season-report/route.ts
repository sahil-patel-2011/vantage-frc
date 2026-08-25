import { withRls } from "@vantage/db";
import { csvFileName, toCsv } from "../../../../lib/export/to-csv";
import { isUuid } from "../../../../lib/finance/reimbursements";
import { computeSeasonReport, SEASON_REPORT_COLUMNS } from "../../../../lib/finance/season-report";
import { requireOrgAdmin, requireTenantSession, tenantErrorResponse } from "../../../../lib/tenant-org-access";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * The season financial report — one CSV of the complete unified ledger with a
 * running balance, for handing the books to next year's treasurer.
 *
 * OWNER/ADMIN ONLY. The rest of the finance surface is member-readable, but a
 * single file containing every dollar the team has ever moved is a different
 * thing to hand out than a balance tile, and it is the one export that leaves
 * the app entirely.
 *
 * `?format=json` returns the same rows plus the reconciliation flag, which is
 * what the /reimbursements panel uses to tell the treasurer whether the file
 * ties out before they download it.
 */
export async function GET(request: Request) {
  const session = await requireTenantSession().catch(() => null);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const orgId = url.searchParams.get("orgId");
  const wantsJson = url.searchParams.get("format") === "json";
  if (!isUuid(orgId)) return Response.json({ error: "orgId is required" }, { status: 400 });

  try {
    const { report, orgLabel } = await withRls({ userId: session.user.id, orgId }, async (client) => {
      await requireOrgAdmin(client, orgId, session.user.id);
      const org = await client.query<{ label: string | null }>(
        `SELECT COALESCE(NULLIF(team_number::text, ''), name) AS label
         FROM organizations WHERE id = $1::uuid`,
        [orgId],
      );
      return {
        report: await computeSeasonReport(client, orgId),
        orgLabel: org.rows[0]?.label ?? null,
      };
    });

    if (report.status !== "ready") {
      // Degrade to a clear "configure this", never a hard failure or an empty
      // file that looks like the team has no money history.
      return Response.json(report, { status: 200 });
    }
    if (wantsJson) return Response.json(report);

    const csv = toCsv(report.rows, SEASON_REPORT_COLUMNS);
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${csvFileName("season-financial-report", orgLabel)}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return tenantErrorResponse(error, "Could not build the season financial report.");
  }
}
