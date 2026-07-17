import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

async function session() {
  const value = await auth.api.getSession({ headers: await headers() });
  if (!value) throw new Error("Authentication required");
  return value;
}
const fail = (error: unknown) =>
  Response.json({ error: error instanceof Error ? error.message : "Budget request failed" }, { status: 400 });

export async function GET(request: Request) {
  try {
    const current = await session();
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    const seasonYear = Number(url.searchParams.get("seasonYear") ?? new Date().getFullYear());
    if (!orgId) throw new Error("orgId is required");
    const categories = await withRls({ userId: current.user.id, orgId }, async (client) => {
      const result = await client.query(
        `SELECT c.id AS "categoryId", c.name, c.season_year AS "seasonYear",
                p.id AS "planId", p.monthly_limit_usd AS "monthlyLimitUsd",
                p.total_limit_usd AS "totalLimitUsd", p.notes
         FROM finance_categories c
         LEFT JOIN finance_budget_plans p ON p.category_id = c.id
         WHERE c.org_id=$1 AND c.season_year=$2
         ORDER BY c.name`,
        [orgId, seasonYear],
      );
      return result.rows;
    });
    return Response.json({ seasonYear, categories });
  } catch (error) { return fail(error); }
}

export async function POST(request: Request) {
  try {
    const current = await session();
    const body = (await request.json()) as Record<string, unknown>;
    const orgId = String(body.orgId ?? "");
    const seasonYear = Number(body.seasonYear);
    const categoryName = String(body.categoryName ?? "").trim();
    if (!orgId) throw new Error("orgId is required");
    if (!Number.isInteger(seasonYear)) throw new Error("seasonYear is required");
    if (!categoryName) throw new Error("Category name is required");
    const monthlyLimitUsd = body.monthlyLimitUsd != null && body.monthlyLimitUsd !== "" ? Number(body.monthlyLimitUsd) : null;
    const totalLimitUsd = body.totalLimitUsd != null && body.totalLimitUsd !== "" ? Number(body.totalLimitUsd) : null;
    if (monthlyLimitUsd != null && (!Number.isFinite(monthlyLimitUsd) || monthlyLimitUsd < 0))
      throw new Error("Monthly limit must be zero or greater");
    if (totalLimitUsd != null && (!Number.isFinite(totalLimitUsd) || totalLimitUsd < 0))
      throw new Error("Total limit must be zero or greater");
    const plan = await withRls({ userId: current.user.id, orgId }, async (client) => {
      const admin = await client.query(
        `SELECT 1 FROM memberships WHERE org_id=$1 AND user_id=$2 AND role IN ('owner','admin')`,
        [orgId, current.user.id],
      );
      if (!admin.rowCount) throw new Error("Organization administrator access required");
      const category = await client.query(
        `INSERT INTO finance_categories(org_id, season_year, name) VALUES($1,$2,$3)
         ON CONFLICT(org_id, season_year, name) DO UPDATE SET name=excluded.name
         RETURNING id`,
        [orgId, seasonYear, categoryName],
      );
      const categoryId = category.rows[0].id as string;
      const before = (await client.query(`SELECT * FROM finance_budget_plans WHERE category_id=$1`, [categoryId])).rows[0] ?? null;
      const result = await client.query(
        `INSERT INTO finance_budget_plans(org_id, category_id, monthly_limit_usd, total_limit_usd, notes, set_by)
         VALUES($1,$2,$3,$4,$5,$6)
         ON CONFLICT(category_id) DO UPDATE SET monthly_limit_usd=excluded.monthly_limit_usd,
           total_limit_usd=excluded.total_limit_usd, notes=excluded.notes, set_by=excluded.set_by, updated_at=now()
         RETURNING id, category_id AS "categoryId", monthly_limit_usd AS "monthlyLimitUsd",
           total_limit_usd AS "totalLimitUsd", notes`,
        [orgId, categoryId, monthlyLimitUsd, totalLimitUsd, body.notes ?? null, current.user.id],
      );
      await client.query(
        `INSERT INTO finance_audit_log(org_id, actor_user_id, action, before, after)
         VALUES($1,$2,$3,$4::jsonb,$5::jsonb)`,
        [orgId, current.user.id, "finance_budget.updated", JSON.stringify(before), JSON.stringify(result.rows[0])],
      );
      return result.rows[0];
    });
    return Response.json({ success: true, plan });
  } catch (error) { return fail(error); }
}
