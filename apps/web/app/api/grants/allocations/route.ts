import { withRls } from "@vantage/db";
import {
  allocateGrantFinance,
  listGrantAllocations,
  parseGrantAllocationInput,
} from "../../../../lib/grant-report/allocate";
import {
  requireGrantApplicationInOrg,
  requireOrgAdmin,
  requireOrgMember,
  requireTenantSession,
  tenantErrorResponse,
} from "../../../../lib/tenant-org-access";

export async function GET(request: Request) {
  try {
    const current = await requireTenantSession();
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    const grantApplicationId = url.searchParams.get("grantApplicationId");
    if (!orgId || !grantApplicationId) throw new Error("orgId and grantApplicationId are required");
    const allocations = await withRls({ userId: current.user.id, orgId }, async (client) => {
      await requireOrgMember(client, orgId, current.user.id);
      await requireGrantApplicationInOrg(client, orgId, grantApplicationId);
      return listGrantAllocations(client, { orgId, grantApplicationId });
    });
    return Response.json({ allocations });
  } catch (error) {
    return tenantErrorResponse(error, "Grant allocation request failed");
  }
}

export async function POST(request: Request) {
  try {
    const current = await requireTenantSession();
    const body = (await request.json()) as Record<string, unknown>;
    const parsed = parseGrantAllocationInput(body);
    if (!parsed.ok) throw new Error(parsed.error);
    const allocation = await withRls({ userId: current.user.id, orgId: parsed.value.orgId }, async (client) => {
      await requireOrgAdmin(client, parsed.value.orgId, current.user.id);
      await requireGrantApplicationInOrg(client, parsed.value.orgId, parsed.value.grantApplicationId);
      return allocateGrantFinance(client, { ...parsed.value, createdBy: current.user.id });
    });
    return Response.json({ allocation });
  } catch (error) {
    return tenantErrorResponse(error, "Grant allocation request failed");
  }
}
