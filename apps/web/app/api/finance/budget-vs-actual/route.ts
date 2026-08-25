import { withRls } from "@vantage/db";
import { computeBudgetVsActual, type BudgetVsActualView } from "../../../../lib/finance/budget-vs-actual";
import { currentSeasonYear, isUuid } from "../../../../lib/finance/reimbursements";
import { requireOrgMember, requireTenantSession, tenantErrorResponse } from "../../../../lib/tenant-org-access";

export const runtime = "nodejs";

/**
 * Season budgets joined to unified-ledger actuals, by category.
 *
 * Readable by any org member (matching the finance_categories /
 * finance_budget_plans *_member_read policies from 0035): knowing the team is
 * 90% through the travel budget is exactly the thing a build lead should see
 * before ordering. RLS is the backstop; requireOrgMember makes a wrong orgId an
 * explicit 403 rather than an empty-looking 200.
 */
export async function GET(request: Request) {
  const session = await requireTenantSession().catch(() => null);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const orgId = url.searchParams.get("orgId");
  const seasonParam = Number(url.searchParams.get("seasonYear"));
  const seasonYear =
    Number.isFinite(seasonParam) && seasonParam > 1992 ? Math.round(seasonParam) : currentSeasonYear();
  if (!isUuid(orgId)) return Response.json({ error: "orgId is required" }, { status: 400 });

  try {
    const view = await withRls({ userId: session.user.id, orgId }, async (client) => {
      await requireOrgMember(client, orgId, session.user.id);
      return computeBudgetVsActual(client, orgId, seasonYear);
    });
    return Response.json(view);
  } catch (error) {
    if (error instanceof Error && /access denied|administrator/i.test(error.message)) {
      return tenantErrorResponse(error);
    }
    return Response.json(
      {
        status: "setup_required",
        message: "Budget vs actual is unavailable right now. Confirm database access and try again.",
        orgId,
        seasonYear,
      } satisfies BudgetVsActualView,
      { status: 200 },
    );
  }
}
