import { assertScoutingLead, canManageScouting } from "@vantage/scouting/permissions";
import { auth } from "@vantage/core";
import { lockScoutingSchemaVersion, ScoutingRepository } from "@vantage/scouting/repository";
import type { SchemaDefinition } from "@vantage/scouting";
import { lintSchemaBudget } from "@vantage/scouting/trust";
import { assertSchemaIdentityLock, stripScoutIdentityFields } from "@vantage/scouting/identity";
import { headers } from "next/headers";
import {
  scoutingErrorResponse,
  withScoutingRequest,
} from "../../../../lib/scouting-auth";
import { latestScoutingYear } from "../../../../lib/scouting/free-scout";
import { schemaPublicationRequest } from "../../../../lib/scouting/schema-publication";
import { parseSecureJson, RequestSecurityError, securityErrorResponse } from "../../../../lib/security/request";

export const dynamic = "force-dynamic";

/** List latest match/pit schemas for the org's active season (form builder). */
export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return Response.json({ error: "Your session ended. Sign in again." }, { status: 401 });
    const query = new URL(request.url).searchParams;
    const orgId = query.get("orgId");
    const schemaId = query.get("schemaId");
    if (schemaId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(schemaId)) {
      return Response.json({ error: "Invalid form version." }, { status: 400 });
    }
    const data = await withScoutingRequest(orgId, async (client) => {
      // Author corrections against their original published form, including older versions.
      // getSchema enforces both tenant ownership and the request's scouting access policy.
      if (schemaId) {
        const schema = await new ScoutingRepository(client).getSchema(orgId!, schemaId);
        return { schemas: [schema] };
      }
      const allowed = await canManageScouting(client, orgId!);
      const context = await client.query<{ eventKey: string | null; year: number | null }>(
        `SELECT c.active_event_key AS "eventKey", e.year
         FROM org_active_context c
         LEFT JOIN events_ref e ON e.event_key = c.active_event_key
         WHERE c.org_id = $1`,
        [orgId],
      );
      const eventKey = context.rows[0]?.eventKey ?? null;
      const requestedYear = Number(new URL(request.url).searchParams.get("year"));
      const year = Number.isInteger(requestedYear) && requestedYear >= 1992 && requestedYear <= 2100
        ? requestedYear : context.rows[0]?.year ?? latestScoutingYear();
      if (!year) {
        return {
          userId: session.user.id,
          eventKey,
          year: null,
          canManageSchemas: allowed,
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
        userId: session.user.id,
        eventKey,
        year,
        canManageSchemas: allowed,
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
    if (!session) return Response.json({ error: "Your session ended. Sign in again." }, { status: 401 });
    const body = await parseSecureJson(request, schemaPublicationRequest, { maxBytes: 262_144 });

    if ("action" in body && body.action === "ensure_defaults") {
      const result = await withScoutingRequest(body.orgId, async (client) => {
        await assertScoutingLead(client, body.orgId!);
        const selected = body.eventKey ? await client.query<{ eventKey: string; eventName: string | null }>(
          'SELECT event_key AS "eventKey",name AS "eventName" FROM events_ref WHERE event_key=$1', [body.eventKey]) : null;
        if (body.eventKey && !selected?.rows[0]) throw new RequestSecurityError(404, "This event is not available. Choose another event.");
        const context = selected ? null : await client.query<{ eventKey: string | null }>(
          `SELECT active_event_key AS "eventKey" FROM org_active_context WHERE org_id = $1`,
          [body.orgId],
        );
        const eventKey = selected?.rows[0]?.eventKey ?? context?.rows[0]?.eventKey;
        if (!eventKey) throw new Error("Set your active event before creating starter forms.");
        const repository = new ScoutingRepository(client);
        await repository.ensureDefaultSchemas(body.orgId!, session.user.id, eventKey);
        return repository.bootstrap(body.orgId!, session.user.id, selected?.rows[0]);
      });
      return Response.json(result, { headers: { "cache-control": "private, no-store" } });
    }

    if (!("definition" in body)) return Response.json({ error: "Invalid schema" }, { status: 400 });
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
      await assertScoutingLead(client, body.orgId!);
      // withScoutingRequest supplies a transaction. Serialize competing lead
      // publications before reading MAX(version), including the first version.
      await lockScoutingSchemaVersion(client, body.orgId, body.year, body.type);
      const latest = await client.query<{ id: string; version: number }>(
        `SELECT id, version FROM scout_schemas WHERE org_id=$1 AND year=$2 AND type=$3 ORDER BY version DESC LIMIT 1`,
        [body.orgId, body.year, body.type],
      );
      if (body.baseSchemaId === undefined) throw new RequestSecurityError(409, "Refresh the form editor before publishing so its current version can be checked.");
      if ((latest.rows[0]?.id ?? null) !== body.baseSchemaId) {
        throw new RequestSecurityError(409, "Another lead published a newer form. Your draft is safe. Review the latest form before publishing.");
      }
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
    return Response.json({ ...schema, definition: lockedDefinition, budget }, { status: 201 });
  } catch (error) {
    if (error instanceof RequestSecurityError) return securityErrorResponse(error, "Could not publish this form.");
    return scoutingErrorResponse(error);
  }
}
