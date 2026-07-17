import { auth } from "@vantage/core";
import { ScoutingRepository } from "@vantage/scouting/repository";
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
      action?: "ensure_defaults";
      year?: number;
      type?: "match" | "pit";
      definition?: SchemaDefinition;
    };
    if (!body.orgId) return Response.json({ error: "orgId is required" }, { status: 400 });

    if (body.action === "ensure_defaults") {
      const result = await withScoutingRequest(body.orgId, async (client) => {
        const allowed = await client.query(
          `SELECT has_org_role($1, ARRAY['owner','admin']::org_role[]) AS allowed`,
          [body.orgId],
        );
        if (!allowed.rows[0]?.allowed) throw new Error("Coach role required");
        const context = await client.query<{ eventKey: string | null }>(
          `SELECT active_event_key AS "eventKey" FROM org_active_context WHERE org_id = $1`,
          [body.orgId],
        );
        const eventKey = context.rows[0]?.eventKey;
        if (!eventKey) throw new Error("Select an active event before creating starter forms.");
        const repository = new ScoutingRepository(client);
        await repository.ensureDefaultSchemas(body.orgId!, session.user.id, eventKey);
        return repository.bootstrap(body.orgId!, session.user.id);
      });
      return Response.json(result);
    }

    if (!body.year || !body.type || !body.definition?.fields.length) {
      return Response.json({ error: "Invalid schema" }, { status: 400 });
    }
    const schema = await withScoutingRequest(body.orgId, async (client) => {
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
