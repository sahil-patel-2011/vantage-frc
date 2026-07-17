import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

async function session() {
  const value = await auth.api.getSession({ headers: await headers() });
  if (!value) throw new Error("Authentication required");
  return value;
}
const fail = (error: unknown) =>
  Response.json({ error: error instanceof Error ? error.message : "Sponsor contribution request failed" }, { status: 400 });

const RETURNING = `id, sponsor_id AS "sponsorId", season_year AS "seasonYear", type, amount_usd AS "amountUsd",
  estimated_value_usd AS "estimatedValueUsd", description, received_at AS "receivedAt",
  thank_you_sent_at AS "thankYouSentAt"`;

export async function GET(request: Request) {
  try {
    const current = await session();
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    const sponsorId = url.searchParams.get("sponsorId");
    const seasonYear = url.searchParams.get("seasonYear");
    if (!orgId) throw new Error("orgId is required");
    const conditions = ["org_id=$1"];
    const params: unknown[] = [orgId];
    if (sponsorId) { params.push(sponsorId); conditions.push(`sponsor_id=$${params.length}`); }
    if (seasonYear) { params.push(Number(seasonYear)); conditions.push(`season_year=$${params.length}`); }
    const contributions = await withRls({ userId: current.user.id, orgId }, async (client) => {
      const result = await client.query(
        `SELECT ${RETURNING} FROM sponsor_contributions WHERE ${conditions.join(" AND ")} ORDER BY received_at DESC`,
        params,
      );
      return result.rows;
    });
    return Response.json({ contributions });
  } catch (error) { return fail(error); }
}

export async function POST(request: Request) {
  try {
    const current = await session();
    const body = (await request.json()) as Record<string, unknown>;
    const orgId = String(body.orgId ?? "");
    const sponsorId = String(body.sponsorId ?? "");
    const type = String(body.type ?? "");
    const seasonYear = Number(body.seasonYear ?? new Date().getFullYear());
    if (!orgId || !sponsorId) throw new Error("orgId and sponsorId are required");
    if (!["cash", "in_kind", "discount"].includes(type)) throw new Error("Invalid contribution type");
    const amountUsd = body.amountUsd != null && body.amountUsd !== "" ? Number(body.amountUsd) : null;
    const estimatedValueUsd = body.estimatedValueUsd != null && body.estimatedValueUsd !== "" ? Number(body.estimatedValueUsd) : null;
    const contribution = await withRls({ userId: current.user.id, orgId }, async (client) => {
      const admin = await client.query(
        `SELECT 1 FROM memberships WHERE org_id=$1 AND user_id=$2 AND role IN ('owner','admin')`,
        [orgId, current.user.id],
      );
      if (!admin.rowCount) throw new Error("Organization administrator access required");
      const result = await client.query(
        `INSERT INTO sponsor_contributions(sponsor_id, org_id, season_year, type, amount_usd, estimated_value_usd, description, received_at, created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,COALESCE($8,now()),$9)
         RETURNING ${RETURNING}`,
        [sponsorId, orgId, seasonYear, type, amountUsd, estimatedValueUsd, body.description || null, body.receivedAt || null, current.user.id],
      );
      if (type === "cash" && amountUsd && amountUsd > 0) {
        await client.query(
          `INSERT INTO finance_transactions(org_id, season_year, type, source, amount_usd, sponsor_contribution_id, description, created_by)
           VALUES($1,$2,'income','sponsor_contribution',$3,$4,$5,$6)`,
          [orgId, seasonYear, amountUsd, result.rows[0].id, "Sponsor contribution", current.user.id],
        );
      }
      await client.query(`UPDATE sponsors SET status='active' WHERE id=$1 AND status='prospect'`, [sponsorId]);
      return result.rows[0];
    });
    return Response.json({ contribution });
  } catch (error) { return fail(error); }
}

export async function PATCH(request: Request) {
  try {
    const current = await session();
    const body = (await request.json()) as Record<string, unknown>;
    const orgId = String(body.orgId ?? "");
    const id = String(body.id ?? "");
    if (!orgId || !id) throw new Error("orgId and id are required");
    const contribution = await withRls({ userId: current.user.id, orgId }, async (client) => {
      const admin = await client.query(
        `SELECT 1 FROM memberships WHERE org_id=$1 AND user_id=$2 AND role IN ('owner','admin')`,
        [orgId, current.user.id],
      );
      if (!admin.rowCount) throw new Error("Organization administrator access required");
      const result = await client.query(
        `UPDATE sponsor_contributions SET thank_you_sent_at=now() WHERE id=$1 AND org_id=$2 RETURNING ${RETURNING}`,
        [id, orgId],
      );
      if (!result.rowCount) throw new Error("Contribution not found");
      return result.rows[0];
    });
    return Response.json({ success: true, contribution });
  } catch (error) { return fail(error); }
}
