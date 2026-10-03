import type { SchemaDefinition } from "@vantage/scouting";
import { scoutingErrorResponse, ScoutingHttpError, withScoutingRequest } from "../../../../lib/scouting-auth";
import { portableScoutDefinition, UUID_PATTERN } from "../../../../lib/scouting/free-scout";

export const dynamic = "force-dynamic";

type ResponseRow = {
  id: string;
  team: string;
  label: string;
  event: string | null;
  payload: Record<string, unknown>;
  observedAt: string;
  scoutId: string;
  scout: string;
  mine: boolean;
};

/**
 * One team's form history. Stable answer keys keep older responses available after edits.
 *
 * Who filed each response goes to team leads (owner / admin) only, with a per-scout total
 * counted over every response, not just the page returned. Everyone else learns which rows
 * are their own and nothing about anyone else's.
 */
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
      const lead = await client.query<{ allowed: boolean }>(
        `SELECT has_org_role($1, ARRAY['owner','admin']::org_role[]) AS allowed`, [orgId],
      );
      const canSeeScouts = Boolean(lead.rows[0]?.allowed);
      // Only the two hard-coded table names can reach the SQL interpolation.
      const table = schema.type === "pit" ? "pit_scout_entries" : "match_scout_entries";
      const responses = `
        SELECT id::text, team_key AS team, ${schema.type === "pit" ? "'Pit'::text" : "match_key"} AS label,
               event_key AS event, payload, updated_at AS "observedAt", scout_user_id AS "scoutId"
          FROM ${table}
         WHERE org_id=$1 AND schema_id IN (SELECT id FROM scout_schemas WHERE org_id=$1 AND year=$2 AND type::text=$3)
        UNION ALL
        SELECT id::text, 'frc' || team_number::text AS team, label, NULL AS event, payload,
               observed_at AS "observedAt", scout_user_id AS "scoutId"
          FROM free_scout_reports
         WHERE org_id=$1 AND year=$2 AND type::text=$3 AND definition=ANY($4::jsonb[])`;
      const args = [orgId, schema.year, schema.type, history.rows.map(version => JSON.stringify(portableScoutDefinition(version.definition)))];
      const rows = await client.query<ResponseRow>(
        `SELECT r.id, r.team, r.label, r.event, r.payload, r."observedAt", r."scoutId"::text AS "scoutId",
                COALESCE(NULLIF(btrim(u.name), ''), 'Team scout') AS scout,
                (r."scoutId" = current_app_user_id()) AS mine
           FROM (${responses}) r LEFT JOIN users u ON u.id = r."scoutId"
          ORDER BY r."observedAt" DESC LIMIT 501`,
        args,
      );
      const scouts = canSeeScouts
        ? (await client.query<{ id: string; name: string; total: number; teams: number; lastAt: string }>(
            `SELECT r."scoutId"::text AS id,
                    COALESCE(NULLIF(btrim(max(u.name)), ''), 'Team scout') AS name,
                    count(*)::int AS total,
                    count(DISTINCT r.team)::int AS teams,
                    max(r."observedAt") AS "lastAt"
               FROM (${responses}) r LEFT JOIN users u ON u.id = r."scoutId"
              GROUP BY r."scoutId"
              ORDER BY total DESC, name`,
            args,
          )).rows
        : null;
      // Teammates who scout but have filed nothing on this form. Viewers are not expected to.
      const idle = scouts
        ? (await client.query<{ name: string }>(
            `SELECT COALESCE(NULLIF(btrim(u.name), ''), 'Team member') AS name
               FROM memberships m JOIN users u ON u.id = m.user_id
              WHERE m.org_id = $1 AND m.role <> 'viewer' AND NOT (m.user_id::text = ANY($2::text[]))
              ORDER BY name LIMIT 60`,
            [orgId, scouts.map(scout => scout.id)],
          )).rows.map(row => row.name)
        : null;
      return {
        definition: { ...schema.definition, fields: [...fields.values()] },
        rows: rows.rows.slice(0, 500).map(({ scoutId, scout, ...row }) => (canSeeScouts ? { ...row, scoutId, scout } : row)),
        hasMore: rows.rows.length > 500,
        scouts,
        idle,
      };
    });
    return Response.json(data, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return scoutingErrorResponse(error); }
}
