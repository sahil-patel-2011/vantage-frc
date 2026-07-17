import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

async function session() {
  const value = await auth.api.getSession({ headers: await headers() });
  if (!value) throw new Error("Authentication required");
  return value;
}
const fail = (error: unknown) =>
  Response.json({ error: error instanceof Error ? error.message : "Category request failed" }, { status: 400 });

export async function GET(request: Request) {
  try {
    const current = await session();
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    const seasonYear = url.searchParams.get("seasonYear");
    if (!orgId) throw new Error("orgId is required");
    const categories = await withRls({ userId: current.user.id, orgId }, async (client) => {
      const result = await client.query(
        `SELECT id, season_year AS "seasonYear", name, created_at AS "createdAt"
         FROM finance_categories WHERE org_id=$1 ${seasonYear ? "AND season_year=$2" : ""}
         ORDER BY name`,
        seasonYear ? [orgId, Number(seasonYear)] : [orgId],
      );
      return result.rows;
    });
    return Response.json({ categories });
  } catch (error) { return fail(error); }
}

export async function POST(request: Request) {
  try {
    const current = await session();
    const body = (await request.json()) as Record<string, unknown>;
    const orgId = String(body.orgId ?? "");
    const name = String(body.name ?? "").trim();
    const seasonYear = Number(body.seasonYear);
    if (!orgId) throw new Error("orgId is required");
    if (!name) throw new Error("Category name is required");
    if (!Number.isInteger(seasonYear)) throw new Error("seasonYear is required");
    const category = await withRls({ userId: current.user.id, orgId }, async (client) => {
      const admin = await client.query(
        `SELECT 1 FROM memberships WHERE org_id=$1 AND user_id=$2 AND role IN ('owner','admin')`,
        [orgId, current.user.id],
      );
      if (!admin.rowCount) throw new Error("Organization administrator access required");
      const result = await client.query(
        `INSERT INTO finance_categories(org_id, season_year, name) VALUES($1,$2,$3)
         ON CONFLICT(org_id, season_year, name) DO UPDATE SET name=excluded.name
         RETURNING id, season_year AS "seasonYear", name, created_at AS "createdAt"`,
        [orgId, seasonYear, name],
      );
      return result.rows[0];
    });
    return Response.json({ category });
  } catch (error) { return fail(error); }
}
