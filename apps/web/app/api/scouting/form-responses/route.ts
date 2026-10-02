import type { SchemaDefinition } from "@vantage/scouting";
import { scoutingErrorResponse, ScoutingHttpError, withScoutingRequest } from "../../../../lib/scouting-auth";
import { portableScoutDefinition, UUID_PATTERN } from "../../../../lib/scouting/free-scout";

export const dynamic = "force-dynamic";

/** One team's form history. Stable answer keys keep older responses available after edits. */
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const orgId = params.get("orgId");
    const schemaId = params.get("schemaId");
    if (!schemaId || !UUID_PATTERN.test(schemaId)) throw new ScoutingHttpError(400, "Choose a published form.");
    const data = await withScoutingRequest(orgId, async client => {
      const schemas = await client.query<{ definition: SchemaDefinition; type: string; year: number }>(
        'SELECT schema AS definition, type, year FROM scout_schemas WHERE id=$1 AND org_id=$2', [schemaId, orgId],
      );
      const schema = schemas.rows[0];
      if (!schema) throw new ScoutingHttpError(404, "This form is unavailable for your team.");
      const history = await client.query<{ definition: SchemaDefinition }>(
        'SELECT schema AS definition FROM scout_schemas WHERE org_id=$1 AND year=$2 AND type=$3 ORDER BY version DESC',
        [orgId, schema.year, schema.type],
      );
      const fields = new Map<string, SchemaDefinition["fields"][number]>();
      for (const version of history.rows) for (const field of version.definition.fields) {
        if (!fields.has(field.key)) fields.set(field.key, field);
      }
      // Only the two hard-coded table names can reach the SQL interpolation.
      const table = schema.type === "pit" ? "pit_scout_entries" : "match_scout_entries";
      const rows = await client.query(
        `SELECT id::text, team_key AS team, ${schema.type === "pit" ? "'Pit'::text" : "match_key"} AS label,
           event_key AS event, payload, updated_at AS "observedAt" FROM ${table}
         WHERE org_id=$1 AND schema_id IN (SELECT id FROM scout_schemas WHERE org_id=$1 AND year=$2 AND type::text=$3)
         UNION ALL
         SELECT id::text, 'frc' || team_number::text AS team, label, NULL AS event, payload, observed_at AS "observedAt"
         FROM free_scout_reports WHERE org_id=$1 AND year=$2 AND type::text=$3 AND definition=ANY($4::jsonb[])
         ORDER BY "observedAt" DESC LIMIT 501`,
        [orgId, schema.year, schema.type, history.rows.map(version => JSON.stringify(portableScoutDefinition(version.definition)))],
      );
      return { definition: { ...schema.definition, fields: [...fields.values()] }, rows: rows.rows.slice(0, 500), hasMore: rows.rows.length > 500 };
    });
    return Response.json(data, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return scoutingErrorResponse(error); }
}
