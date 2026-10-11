import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { publicErrorMessage } from "../../../../lib/security/public-error";
import {
  FINANCE_MANAGER_REQUIRED,
  assertFinanceManager,
  canManageFinances,
  isFinanceAccessDenied,
} from "../../../../lib/finance/finance-managers";

async function session() {
  const value = await auth.api.getSession({ headers: await headers() });
  if (!value) throw new Error("Authentication required");
  return value;
}
const fail = (error: unknown) =>
  isFinanceAccessDenied(error)
    ? Response.json({ error: FINANCE_MANAGER_REQUIRED, reason: "not_finance_manager" }, { status: 403 })
    : Response.json({ error: publicErrorMessage(error, "Category request failed") }, { status: 400 });

export async function GET(request: Request) {
  try {
    const current = await session();
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    const seasonYear = url.searchParams.get("seasonYear");
    if (!orgId) throw new Error("orgId is required");
    const { categories, canManage } = await withRls({ userId: current.user.id, orgId }, async (client) => {
      const result = await client.query(
        `SELECT id, season_year AS "seasonYear", name, created_at AS "createdAt"
         FROM finance_categories WHERE org_id=$1 ${seasonYear ? "AND season_year=$2" : ""}
         ORDER BY name`,
        seasonYear ? [orgId, Number(seasonYear)] : [orgId],
      );
      return { categories: result.rows, canManage: await canManageFinances(client, orgId) };
    });
    return Response.json({ categories, canManageFinances: canManage });
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
      await assertFinanceManager(client, orgId);
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
