import { withRls } from "@vantage/db";
import { computeFinanceBalance, type FinanceBalanceView } from "../../../../lib/finance/balance";
import {
  requireOrgMember,
  requireTenantSession,
  TenantHttpError,
} from "../../../../lib/tenant-org-access";

export type { FinanceBalanceView };

function uuidOrNull(value: unknown): string | null {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

export async function GET(request: Request) {
  const session = await requireTenantSession().catch(() => null);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const orgId = uuidOrNull(url.searchParams.get("orgId"));
  if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });

  try {
    const view = await withRls({ userId: session.user.id, orgId }, async (client) => {
      // Any org member may read money data — matches the *_member_read RLS
      // policies in 0035 and the convention in /api/finance/summary. RLS is
      // the backstop; this check turns wrong-org into an explicit 403.
      await requireOrgMember(client, orgId, session.user.id);
      return computeFinanceBalance(client, orgId);
    });
    return Response.json(view);
  } catch (error) {
    if (error instanceof TenantHttpError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    // Degrade to a clear setup state instead of a hard 500 when the DB is
    // unreachable (product routes are setup-required by design without one).
    return Response.json(
      {
        status: "setup_required",
        message: "Balance is unavailable right now. Confirm database access and try again.",
        orgId,
      } satisfies FinanceBalanceView,
      { status: 200 },
    );
  }
}
