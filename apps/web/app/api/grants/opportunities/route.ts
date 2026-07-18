import { withRls } from "@vantage/db";
import { validateGrantOpportunityInput } from "../../../../lib/grants";
import {
  requireOrgAdmin,
  requireOrgMember,
  requireTenantSession,
  tenantErrorResponse,
} from "../../../../lib/tenant-org-access";

const RETURNING = `id, name, funder, description, amount_min_usd AS "amountMinUsd", amount_max_usd AS "amountMaxUsd",
  deadline, eligibility_notes AS "eligibilityNotes", application_url AS "applicationUrl", created_at AS "createdAt"`;

export async function GET(request: Request) {
  try {
    const current = await requireTenantSession();
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    if (!orgId) throw new Error("orgId is required");
    const opportunities = await withRls({ userId: current.user.id, orgId }, async (client) => {
      await requireOrgMember(client, orgId, current.user.id);
      const result = await client.query(
        `SELECT ${RETURNING} FROM grant_opportunities WHERE org_id=$1::uuid ORDER BY deadline NULLS LAST, name`,
        [orgId],
      );
      return result.rows;
    });
    return Response.json({ opportunities });
  } catch (error) {
    return tenantErrorResponse(error, "Grant opportunity request failed");
  }
}

export async function POST(request: Request) {
  try {
    const current = await requireTenantSession();
    const body = (await request.json()) as Record<string, unknown>;
    const orgId = String(body.orgId ?? "");
    if (!orgId) throw new Error("orgId is required");
    const validated = validateGrantOpportunityInput({
      name: body.name as string | undefined,
      funder: body.funder as string | undefined,
      amountMinUsd: body.amountMinUsd != null && body.amountMinUsd !== "" ? Number(body.amountMinUsd) : null,
      amountMaxUsd: body.amountMaxUsd != null && body.amountMaxUsd !== "" ? Number(body.amountMaxUsd) : null,
    });
    if (!validated.ok) throw new Error(validated.error);
    const opportunity = await withRls({ userId: current.user.id, orgId }, async (client) => {
      await requireOrgAdmin(client, orgId, current.user.id);
      const result = await client.query(
        `INSERT INTO grant_opportunities(org_id, name, funder, description, amount_min_usd, amount_max_usd,
           deadline, eligibility_notes, application_url, created_by)
         VALUES($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10::uuid)
         RETURNING ${RETURNING}`,
        [
          orgId, validated.value.name, validated.value.funder, body.description || null, body.amountMinUsd || null,
          body.amountMaxUsd || null, body.deadline || null, body.eligibilityNotes || null, body.applicationUrl || null,
          current.user.id,
        ],
      );
      return result.rows[0];
    });
    return Response.json({ opportunity });
  } catch (error) {
    return tenantErrorResponse(error, "Grant opportunity request failed");
  }
}

export async function PATCH(request: Request) {
  try {
    const current = await requireTenantSession();
    const body = (await request.json()) as Record<string, unknown>;
    const orgId = String(body.orgId ?? "");
    const id = String(body.id ?? "");
    if (!orgId || !id) throw new Error("orgId and id are required");
    const validated = validateGrantOpportunityInput({
      name: body.name as string | undefined,
      funder: body.funder as string | undefined,
      amountMinUsd: body.amountMinUsd != null && body.amountMinUsd !== "" ? Number(body.amountMinUsd) : null,
      amountMaxUsd: body.amountMaxUsd != null && body.amountMaxUsd !== "" ? Number(body.amountMaxUsd) : null,
    });
    if (!validated.ok) throw new Error(validated.error);
    const opportunity = await withRls({ userId: current.user.id, orgId }, async (client) => {
      await requireOrgAdmin(client, orgId, current.user.id);
      const result = await client.query(
        `UPDATE grant_opportunities SET name=$1, funder=$2, description=$3, amount_min_usd=$4, amount_max_usd=$5,
           deadline=$6, eligibility_notes=$7, application_url=$8, updated_at=now()
         WHERE id=$9::uuid AND org_id=$10::uuid RETURNING ${RETURNING}`,
        [
          validated.value.name, validated.value.funder, body.description || null, body.amountMinUsd || null,
          body.amountMaxUsd || null, body.deadline || null, body.eligibilityNotes || null, body.applicationUrl || null,
          id, orgId,
        ],
      );
      if (!result.rowCount) throw new Error("Grant opportunity not found");
      return result.rows[0];
    });
    return Response.json({ success: true, opportunity });
  } catch (error) {
    return tenantErrorResponse(error, "Grant opportunity request failed");
  }
}
