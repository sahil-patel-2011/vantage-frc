import { assertScoutingLead } from "@vantage/scouting/permissions";
import { auth } from "@vantage/core";
import { formulaFields, type FieldDefinition } from "@vantage/scouting";
import { headers } from "next/headers";
import {
  scoutingErrorResponse,
  withScoutingRequest,
} from "../../../../lib/scouting-auth";
import { parseSecureJson, RequestSecurityError, securityErrorResponse } from "../../../../lib/security/request";
import { formulaRequest } from "../../../../lib/scouting/formula-request";
import { formulaInputError } from "../../../../lib/scouting/formula-editor";

export async function GET(request: Request) {
  try {
    const orgId = new URL(request.url).searchParams.get("orgId");
    const formulas = await withScoutingRequest(orgId, (client) =>
      client.query(
        `SELECT id,name,expression,created_by AS "createdBy",updated_at AS "updatedAt",updated_at::text AS revision
         FROM org_value_formulas WHERE org_id=$1 ORDER BY name`,
        [orgId],
      ),
    );
    return Response.json({ formulas: formulas.rows }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return scoutingErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return Response.json({ error: "Your session ended. Sign in again." }, { status: 401 });
    const body = await parseSecureJson(request, formulaRequest, { maxBytes: 65_536 });
    const name = body.name;
    const formula = await withScoutingRequest(body.orgId, async (client) => {
      await assertScoutingLead(client, body.orgId);
      const form = await client.query<{ fields: FieldDefinition[] }>(
        "SELECT schema->'fields' AS fields FROM scout_schemas WHERE id=$1 AND org_id=$2 AND type='match'",
        [body.schemaId, body.orgId],
      );
      const fields = form.rows[0]?.fields;
      if (!Array.isArray(fields)) throw new RequestSecurityError(422, "Choose a published match form before saving scoring formulas.");
      const known = new Set(fields.map(field => field.key));
      if (formulaFields(body.expression).some(key => !known.has(key))) throw new RequestSecurityError(422, "This formula references questions outside the selected published form. Update those terms before saving.");
      const inputError = formulaInputError(body.expression, fields);
      if (inputError) throw new RequestSecurityError(422, inputError);
      // Serialize an initial save as well as later edits. No schema change is needed.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`scout-formula:${body.orgId.toLowerCase()}:${name}`]);
      const latest = await client.query<{ revision: string }>(
        "SELECT updated_at::text AS revision FROM org_value_formulas WHERE org_id=$1 AND name=$2 FOR UPDATE", [body.orgId, name],
      );
      if (body.baseRevision === undefined) throw new RequestSecurityError(409, "Refresh scoring formulas before saving so the current version can be checked.");
      if ((latest.rows[0]?.revision ?? null) !== body.baseRevision) throw new RequestSecurityError(409, "Another lead changed this formula. Your edits are retained; review the latest formula before saving.");
      const result = await client.query(
        `INSERT INTO org_value_formulas (org_id,name,expression,created_by)
         VALUES ($1,$2,$3::jsonb,$4)
         ON CONFLICT (org_id,name) DO UPDATE SET
           expression=excluded.expression,updated_at=now()
         RETURNING id,name,expression,updated_at AS "updatedAt",updated_at::text AS revision`,
        [body.orgId, name, JSON.stringify(body.expression), session.user.id],
      );
      return result.rows[0];
    });
    return Response.json(formula, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof RequestSecurityError) return securityErrorResponse(error, "Could not save this scoring formula.");
    return scoutingErrorResponse(error);
  }
}
