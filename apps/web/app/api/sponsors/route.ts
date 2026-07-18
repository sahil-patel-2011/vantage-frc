import { withRls } from "@vantage/db";
import { needsFollowUp } from "../../../lib/sponsors";
import {
  requireOrgAdmin,
  requireOrgMember,
  requireTenantSession,
  tenantErrorResponse,
} from "../../../lib/tenant-org-access";

export async function GET(request: Request) {
  try {
    const current = await requireTenantSession();
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    const status = url.searchParams.get("status");
    if (!orgId) throw new Error("orgId is required");
    const sponsors = await withRls({ userId: current.user.id, orgId }, async (client) => {
      await requireOrgMember(client, orgId, current.user.id);
      const result = await client.query(
        `SELECT s.id, s.name, s.website, s.tier, s.status, s.industry, s.city, s.state_prov AS "stateProv",
                s.notes, s.first_sponsored_season AS "firstSponsoredSeason", s.created_at AS "createdAt",
                COALESCE(contrib.total_usd, 0) AS "lifetimeContributionUsd", last_interaction.at AS "lastInteractionAt"
         FROM sponsors s
         LEFT JOIN (
           SELECT sponsor_id, sum(COALESCE(amount_usd, estimated_value_usd, 0)) AS total_usd
           FROM sponsor_contributions GROUP BY sponsor_id
         ) contrib ON contrib.sponsor_id = s.id
         LEFT JOIN (
           SELECT sponsor_id, max(occurred_at) AS at FROM sponsor_interactions GROUP BY sponsor_id
         ) last_interaction ON last_interaction.sponsor_id = s.id
         WHERE s.org_id=$1::uuid ${status ? "AND s.status=$2" : ""}
         ORDER BY s.name`,
        status ? [orgId, status] : [orgId],
      );
      return result.rows;
    });
    const withFlags = sponsors.map((s: Record<string, unknown>) => ({
      ...s,
      needsFollowUp: needsFollowUp((s.lastInteractionAt as string | null) ?? null),
    }));
    return Response.json({ sponsors: withFlags });
  } catch (error) {
    return tenantErrorResponse(error, "Sponsor request failed");
  }
}

export async function POST(request: Request) {
  try {
    const current = await requireTenantSession();
    const body = (await request.json()) as Record<string, unknown>;
    const orgId = String(body.orgId ?? "");
    const name = String(body.name ?? "").trim();
    if (!orgId) throw new Error("orgId is required");
    if (!name) throw new Error("Sponsor name is required");
    const sponsor = await withRls({ userId: current.user.id, orgId }, async (client) => {
      await requireOrgAdmin(client, orgId, current.user.id);
      const result = await client.query(
        `INSERT INTO sponsors(org_id, name, website, tier, status, industry, city, state_prov, notes, first_sponsored_season, created_by)
         VALUES($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::uuid)
         RETURNING id, name, website, tier, status, industry, city, state_prov AS "stateProv", notes,
           first_sponsored_season AS "firstSponsoredSeason", created_at AS "createdAt"`,
        [
          orgId, name, body.website || null, body.tier || "custom", body.status || "prospect",
          body.industry || null, body.city || null, body.stateProv || null, body.notes || null,
          body.firstSponsoredSeason || null, current.user.id,
        ],
      );
      return result.rows[0];
    });
    return Response.json({ sponsor });
  } catch (error) {
    return tenantErrorResponse(error, "Sponsor request failed");
  }
}

export async function PATCH(request: Request) {
  try {
    const current = await requireTenantSession();
    const body = (await request.json()) as Record<string, unknown>;
    const orgId = String(body.orgId ?? "");
    const id = String(body.id ?? "");
    const name = String(body.name ?? "").trim();
    if (!orgId || !id) throw new Error("orgId and id are required");
    if (!name) throw new Error("Sponsor name is required");
    const sponsor = await withRls({ userId: current.user.id, orgId }, async (client) => {
      await requireOrgAdmin(client, orgId, current.user.id);
      const result = await client.query(
        `UPDATE sponsors SET name=$1, website=$2, tier=$3, status=$4, industry=$5, city=$6, state_prov=$7, notes=$8,
           first_sponsored_season=$9, updated_at=now()
         WHERE id=$10::uuid AND org_id=$11::uuid
         RETURNING id, name, website, tier, status, industry, city, state_prov AS "stateProv", notes,
           first_sponsored_season AS "firstSponsoredSeason"`,
        [
          name, body.website || null, body.tier || "custom", body.status || "prospect",
          body.industry || null, body.city || null, body.stateProv || null, body.notes || null,
          body.firstSponsoredSeason || null, id, orgId,
        ],
      );
      if (!result.rowCount) throw new Error("Sponsor not found");
      return result.rows[0];
    });
    return Response.json({ success: true, sponsor });
  } catch (error) {
    return tenantErrorResponse(error, "Sponsor request failed");
  }
}
