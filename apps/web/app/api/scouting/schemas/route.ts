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
import {
  isFormKind,
  loadPreviousSeasonSchema,
  resolveStudioYear,
  saveFormDraft,
} from "../../../../lib/scouting/form-studio";

export const dynamic = "force-dynamic";

/**
 * List latest match/pit schemas for the org's authoring season (form builder).
 * The season is the active event's year when one is set; otherwise it falls back to
 * the FRC season year so a team can author forms in the offseason before any event
 * exists. `yearSource` tells the client which it was.
 */
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
      const studio = await resolveStudioYear(client, orgId!);
      const schemas = await client.query(
        `SELECT DISTINCT ON (type) id, org_id AS "orgId", year, type, version,
          schema AS definition FROM scout_schemas
         WHERE org_id = $1 AND year = $2
         ORDER BY type, version DESC`,
        [orgId, studio.year],
      );
      return {
        eventKey: studio.eventKey,
        year: studio.year,
        yearSource: studio.yearSource,
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
      action?: "ensure_defaults" | "clone_season";
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
        if (!eventKey) throw new Error("Select an active event before creating starter forms.");
        const repository = new ScoutingRepository(client);
        await repository.ensureDefaultSchemas(body.orgId!, session.user.id, eventKey);
        return repository.bootstrap(body.orgId!, session.user.id);
      });
      return Response.json(result);
    }

    if (body.action === "clone_season") {
      // "Start from last season": copy the newest previous-season schema of this kind into
      // THE draft for the authoring year. Nothing is published until the coach publishes.
      const orgId = body.orgId;
      if (!isFormKind(body.type)) return Response.json({ error: "type must be match or pit" }, { status: 400 });
      const formKind = body.type;
      const result = await withScoutingRequest(orgId, async (client) => {
        const allowed = await client.query(
          `SELECT has_org_role($1, ARRAY['owner','admin']::org_role[]) AS allowed`,
          [orgId],
        );
        if (!allowed.rows[0]?.allowed) throw new Error("Coach role required");
        const studio = await resolveStudioYear(client, orgId);
        const targetYear = Number.isInteger(body.year) ? Number(body.year) : studio.year;
        const source = await loadPreviousSeasonSchema(client, { orgId, formKind, year: targetYear });
        if (!source) throw new Error(`No earlier-season ${formKind} form exists to clone.`);
        const draft = await saveFormDraft(client, {
          orgId,
          userId: session.user.id,
          formKind,
          seasonYear: targetYear,
          title: source.definition.title,
          definition: source.definition,
          baseSchemaId: source.id,
        });
        return { draft, source: { id: source.id, year: source.year, version: source.version } };
      });
      return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
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
