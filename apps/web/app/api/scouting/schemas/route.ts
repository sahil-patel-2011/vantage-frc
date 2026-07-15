import { auth } from "@vantage/core";
import type { SchemaDefinition } from "@vantage/scouting";
import { headers } from "next/headers";
import {
  scoutingErrorResponse,
  withScoutingRequest,
} from "../../../../lib/scouting-auth";

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });
    const body = (await request.json()) as {
      orgId?: string;
      year?: number;
      type?: "match" | "pit";
      definition?: SchemaDefinition;
    };
    if (!body.year || !body.type || !body.definition?.fields.length) {
      return Response.json({ error: "Invalid schema" }, { status: 400 });
    }
    const schema = await withScoutingRequest(body.orgId ?? null, async (client) => {
      const allowed = await client.query(
        `SELECT has_org_role($1, ARRAY['owner','admin']::org_role[]) AS allowed`,
        [body.orgId],
      );
      if (!allowed.rows[0]?.allowed) throw new Error("Coach role required");
      const result = await client.query(
        `INSERT INTO scout_schemas (org_id,year,type,version,schema,created_by)
         SELECT $1,$2,$3,COALESCE(MAX(version),0)+1,$4::jsonb,$5
         FROM scout_schemas WHERE org_id=$1 AND year=$2 AND type=$3
         RETURNING id,version`,
        [
          body.orgId, body.year, body.type, JSON.stringify(body.definition),
          session.user.id,
        ],
      );
      return result.rows[0];
    });
    return Response.json(schema, { status: 201 });
  } catch (error) {
    return scoutingErrorResponse(error);
  }
}
