import { withRls } from "@vantage/db";
import { suggestProspectCategories } from "../../../../lib/sponsor-research";
import {
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
    const status = url.searchParams.get("status");
    if (!orgId) throw new Error("orgId is required");
    const prospects = await withRls({ userId: current.user.id, orgId }, async (client) => {
      await requireOrgMember(client, orgId, current.user.id);
      const result = await client.query(
        `SELECT id, company_name AS "companyName", website, rationale, source_urls AS "sourceUrls", status,
                related_sponsor_id AS "relatedSponsorId", suggested_by AS "suggestedBy", created_at AS "createdAt"
         FROM sponsor_prospects WHERE org_id=$1::uuid ${status ? "AND status=$2" : ""} ORDER BY created_at DESC`,
        status ? [orgId, status] : [orgId],
      );
      return result.rows;
    });
    return Response.json({ prospects });
  } catch (error) {
    return tenantErrorResponse(error, "Sponsor prospect request failed");
  }
}

/**
 * Generates starter prospect categories from a static playbook, weighted away
 * from industries this org already has sponsors in. No live web search yet —
 * see apps/web/lib/sponsor-research.ts for the upgrade seam.
 */
export async function POST(request: Request) {
  try {
    const current = await requireTenantSession();
    const body = (await request.json()) as Record<string, unknown>;
    const orgId = String(body.orgId ?? "");
    if (!orgId) throw new Error("orgId is required");
    const prospects = await withRls({ userId: current.user.id, orgId }, async (client) => {
      await requireOrgAdmin(client, orgId, current.user.id);
      const existing = await client.query(
        `SELECT industry, tier, state_prov AS "stateProv" FROM sponsors WHERE org_id=$1::uuid`,
        [orgId],
      );
      const suggestions = suggestProspectCategories(
        existing.rows as { industry: string | null; tier: string; stateProv: string | null }[],
        5,
      );
      const inserted = [];
      for (const suggestion of suggestions) {
        const result = await client.query(
          `INSERT INTO sponsor_prospects(org_id, company_name, rationale, status, suggested_by)
           VALUES($1::uuid,$2,$3,'suggested','heuristic_agent')
           RETURNING id, company_name AS "companyName", website, rationale, status, created_at AS "createdAt"`,
          [orgId, suggestion.category, suggestion.rationale],
        );
        inserted.push(result.rows[0]);
      }
      return inserted;
    });
    return Response.json({ prospects });
  } catch (error) {
    return tenantErrorResponse(error, "Sponsor prospect request failed");
  }
}

export async function PATCH(request: Request) {
  try {
    const current = await requireTenantSession();
    const body = (await request.json()) as Record<string, unknown>;
    const orgId = String(body.orgId ?? "");
    const id = String(body.id ?? "");
    const status = String(body.status ?? "");
    if (!orgId || !id) throw new Error("orgId and id are required");
    if (!["suggested", "reviewing", "contacted", "dismissed"].includes(status)) throw new Error("Invalid status");
    const prospect = await withRls({ userId: current.user.id, orgId }, async (client) => {
      await requireOrgAdmin(client, orgId, current.user.id);
      const result = await client.query(
        `UPDATE sponsor_prospects SET status=$1 WHERE id=$2::uuid AND org_id=$3::uuid
         RETURNING id, company_name AS "companyName", status`,
        [status, id, orgId],
      );
      if (!result.rowCount) throw new Error("Prospect not found");
      return result.rows[0];
    });
    return Response.json({ success: true, prospect });
  } catch (error) {
    return tenantErrorResponse(error, "Sponsor prospect request failed");
  }
}
