import { auth } from "@vantage/core";
import type { FormulaExpression } from "@vantage/scouting";
import { headers } from "next/headers";
import {
  scoutingErrorResponse,
  withScoutingRequest,
} from "../../../../lib/scouting-auth";

export async function GET(request: Request) {
  try {
    const orgId = new URL(request.url).searchParams.get("orgId");
    const formulas = await withScoutingRequest(orgId, (client) =>
      client.query(
        `SELECT id,name,expression,created_by AS "createdBy",updated_at AS "updatedAt"
         FROM org_value_formulas WHERE org_id=$1 ORDER BY name`,
        [orgId],
      ),
    );
    return Response.json({ formulas: formulas.rows });
  } catch (error) {
    return scoutingErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });
    const body = (await request.json()) as {
      orgId?: string;
      name?: string;
      expression?: FormulaExpression;
    };
    if (!body.name?.trim() || !body.expression) {
      return Response.json({ error: "Name and expression are required" }, { status: 400 });
    }
    const name = body.name.trim();
    const formula = await withScoutingRequest(body.orgId ?? null, async (client) => {
      const result = await client.query(
        `INSERT INTO org_value_formulas (org_id,name,expression,created_by)
         VALUES ($1,$2,$3::jsonb,$4)
         ON CONFLICT (org_id,name) DO UPDATE SET
           expression=excluded.expression,updated_at=now()
         RETURNING id,name,expression,updated_at AS "updatedAt"`,
        [body.orgId, name, JSON.stringify(body.expression), session.user.id],
      );
      return result.rows[0];
    });
    return Response.json(formula);
  } catch (error) {
    return scoutingErrorResponse(error);
  }
}
