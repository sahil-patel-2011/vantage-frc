import { auth } from "@vantage/core";
import { ScoutingRepository } from "@vantage/scouting/repository";
import type { SchemaDefinition } from "@vantage/scouting";
import { lintSchemaBudget } from "@vantage/scouting/trust";
import { assertSchemaIdentityLock, stripScoutIdentityFields } from "@vantage/scouting/identity";
import { headers } from "next/headers";
import {
  scoutingErrorResponse,
  withScoutingRequest,
} from "../../../../lib/scouting-auth";

export const dynamic = "force-dynamic";

/** List latest match/pit schemas for the org's active season (form builder). */
export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });
    const orgId = new URL(request.url).searchParams.get("orgId");
    const data = await withScoutingRequest(orgId, async (client) => {
      const allowed = await client.query<{ allowed: boolean }>(
        `SELECT has_org_role($1, ARRAY['owner','admin']::org_role[]) AS allowed`,
        [orgId],
      );
      const context = await client.query<{ eventKey: string | null; year: number | null }>(
        `SELECT c.active_event_key AS "eventKey", e.year
         FROM org_active_context c
         LEFT JOIN events_ref e ON e.event_key = c.active_event_key
         WHERE c.org_id = $1`,
        [orgId],
      );
      const eventKey = context.rows[0]?.eventKey ?? null;
      const year = context.rows[0]?.year ?? null;
      if (!year) {
        return {
          eventKey,
          year: null,
          canManageSchemas: Boolean(allowed.rows[0]?.allowed),
          schemas: [] as Array<{
            id: string;
            orgId: string;
            year: number;
            type: string;
            version: number;
            definition: SchemaDefinition;
          }>,
        };
      }
      const schemas = await client.query(
        `SELECT DISTINCT ON (type) id, org_id AS "orgId", year, type, version,
          schema AS definition FROM scout_schemas
         WHERE org_id = $1 AND year = $2
         ORDER BY type, version DESC`,
        [orgId, year],
      );
      return {
        eventKey,
        year,
        canManageSchemas: Boolean(allowed.rows[0]?.allowed),
        schemas: schemas.rows.map((row) => ({
          ...row,
          definition: stripScoutIdentityFields(
            (row as { definition: SchemaDefinition }).definition,
          ).definition,
        })),
      };
    });
    return Response.json(data, { headers: { "Cache-Control": "private, no-store" } });
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
      action?: "ensure_defaults";
      year?: number;
      type?: "match" | "pit";
      definition?: SchemaDefinition;
      acknowledgeBudget?: boolean;
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
        if (!eventKey) throw new Error("Set your active event before creating starter forms.");
        const repository = new ScoutingRepository(client);
        await repository.ensureDefaultSchemas(body.orgId!, session.user.id, eventKey);
        return repository.bootstrap(body.orgId!, session.user.id);
      });
      return Response.json(result);
    }

    if (!body.year || !body.type || !body.definition?.fields.length) {
      return Response.json({ error: "Invalid schema" }, { status: 400 });
    }
    const identityError = assertSchemaIdentityLock(body.definition);
    if (identityError) {
      return Response.json({ error: identityError }, { status: 422 });
    }
    const lockedDefinition = stripScoutIdentityFields(body.definition).definition;
    const budget = lintSchemaBudget(lockedDefinition);
    if (budget.status === "over_budget" && body.acknowledgeBudget !== true) {
      return Response.json({ error: budget.message, budget, acknowledgeRequired: true }, { status: 422 });
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
          body.orgId, body.year, body.type, JSON.stringify(lockedDefinition),
          session.user.id,
        ],
      );
      return result.rows[0];
    });
    return Response.json({ ...schema, budget }, { status: 201 });
  } catch (error) {
    return scoutingErrorResponse(error);
  }
}
