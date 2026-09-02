import { withRls } from "@vantage/db";
import { mirrorSponsorContribution } from "../../../../lib/finance/mirrors";
import {
  requireSponsorsAdmin,
  requireSponsorsMember,
  requireSponsorInOrg,
  requireTenantSession,
  tenantErrorResponse,
} from "../../../../lib/tenant-org-access";

const RETURNING = `id, sponsor_id AS "sponsorId", season_year AS "seasonYear", type, amount_usd AS "amountUsd",
  estimated_value_usd AS "estimatedValueUsd", description, received_at AS "receivedAt",
  thank_you_sent_at AS "thankYouSentAt"`;

export async function GET(request: Request) {
  try {
    const current = await requireTenantSession();
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    const sponsorId = url.searchParams.get("sponsorId");
    const seasonYear = url.searchParams.get("seasonYear");
    if (!orgId) throw new Error("orgId is required");
    const conditions = ["org_id=$1::uuid"];
    const params: unknown[] = [orgId];
    if (sponsorId) {
      params.push(sponsorId);
      conditions.push(`sponsor_id=$${params.length}::uuid`);
    }
    if (seasonYear) {
      params.push(Number(seasonYear));
      conditions.push(`season_year=$${params.length}`);
    }
    const contributions = await withRls({ userId: current.user.id, orgId }, async (client) => {
      await requireSponsorsMember(client, orgId, current.user.id);
      if (sponsorId) await requireSponsorInOrg(client, orgId, sponsorId);
      const result = await client.query(
        `SELECT ${RETURNING} FROM sponsor_contributions WHERE ${conditions.join(" AND ")} ORDER BY received_at DESC`,
        params,
      );
      return result.rows;
    });
    return Response.json({ contributions });
  } catch (error) {
    return tenantErrorResponse(error, "Sponsor contribution request failed");
  }
}

export async function POST(request: Request) {
  try {
    const current = await requireTenantSession();
    const body = (await request.json()) as Record<string, unknown>;
    const orgId = String(body.orgId ?? "");
    const sponsorId = String(body.sponsorId ?? "");
    const type = String(body.type ?? "");
    const seasonYear = Number(body.seasonYear ?? new Date().getFullYear());
    if (!orgId || !sponsorId) throw new Error("orgId and sponsorId are required");
    if (!["cash", "in_kind", "discount"].includes(type)) throw new Error("Invalid contribution type");
    const amountUsd = body.amountUsd != null && body.amountUsd !== "" ? Number(body.amountUsd) : null;
    const estimatedValueUsd =
      body.estimatedValueUsd != null && body.estimatedValueUsd !== "" ? Number(body.estimatedValueUsd) : null;
    const contribution = await withRls({ userId: current.user.id, orgId }, async (client) => {
      await requireSponsorsAdmin(client, orgId, current.user.id);
      await requireSponsorInOrg(client, orgId, sponsorId);
      const result = await client.query(
        `INSERT INTO sponsor_contributions(sponsor_id, org_id, season_year, type, amount_usd, estimated_value_usd, description, received_at, created_by)
         VALUES($1::uuid,$2::uuid,$3,$4,$5,$6,$7,COALESCE($8,now()),$9::uuid)
         RETURNING ${RETURNING}`,
        [
          sponsorId, orgId, seasonYear, type, amountUsd, estimatedValueUsd,
          body.description || null, body.receivedAt || null, current.user.id,
        ],
      );
      // ONE MONEY LEDGER: cash mirrors through recordMoney keyed
      // (org, 'sponsor_contribution', contribution id) — same transaction, idempotent.
      const sponsor = await client.query<{ name: string }>(
        `SELECT name FROM sponsors WHERE id=$1::uuid AND org_id=$2::uuid`,
        [sponsorId, orgId],
      );
      await mirrorSponsorContribution(client, {
        orgId,
        contributionId: String(result.rows[0].id),
        sponsorName: sponsor.rows[0]?.name ?? "Sponsor",
        seasonYear,
        type,
        amountUsd,
        receivedAt: typeof body.receivedAt === "string" && body.receivedAt ? body.receivedAt : null,
        description: typeof body.description === "string" && body.description.trim() ? body.description.trim() : null,
        createdBy: current.user.id,
      });
      await client.query(
        `UPDATE sponsors SET status='active' WHERE id=$1::uuid AND org_id=$2::uuid AND status='prospect'`,
        [sponsorId, orgId],
      );
      return result.rows[0];
    });
    return Response.json({ contribution });
  } catch (error) {
    return tenantErrorResponse(error, "Sponsor contribution request failed");
  }
}

export async function PATCH(request: Request) {
  try {
    const current = await requireTenantSession();
    const body = (await request.json()) as Record<string, unknown>;
    const orgId = String(body.orgId ?? "");
    const id = String(body.id ?? "");
    if (!orgId || !id) throw new Error("orgId and id are required");
    const contribution = await withRls({ userId: current.user.id, orgId }, async (client) => {
      await requireSponsorsAdmin(client, orgId, current.user.id);
      const result = await client.query(
        `UPDATE sponsor_contributions SET thank_you_sent_at=now() WHERE id=$1::uuid AND org_id=$2::uuid RETURNING ${RETURNING}`,
        [id, orgId],
      );
      if (!result.rowCount) throw new Error("Contribution not found");
      return result.rows[0];
    });
    return Response.json({ success: true, contribution });
  } catch (error) {
    return tenantErrorResponse(error, "Sponsor contribution request failed");
  }
}
