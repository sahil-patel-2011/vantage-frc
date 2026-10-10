import type { SchemaDefinition } from "@vantage/scouting";
import { officialComparisonForField } from "@vantage/scouting/official-fields";
import { qualityReportQuery, QUALITY_REPORT_PAGE_SIZE, type QualityReportPage } from "../../../../lib/scouting/quality-reports";
import { RequestSecurityError } from "../../../../lib/security/request";
import { ScoutingHttpError, scoutingErrorResponse, withScoutingRequest } from "../../../../lib/scouting-auth";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const parsed = qualityReportQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) throw new RequestSecurityError(400, "Choose a valid team, event and original form question.");
    const input = parsed.data;
    const data = await withScoutingRequest(input.orgId, async client => {
      const [form, policy] = await Promise.all([
        client.query<{ type: "match" | "pit"; definition: SchemaDefinition }>(
          'SELECT type,schema AS definition FROM scout_schemas WHERE org_id=$1::uuid AND id=$2::uuid', [input.orgId, input.schemaId]),
        client.query<{ enabled: boolean }>(
          'SELECT enabled FROM scout_field_policies WHERE org_id=$1::uuid AND schema_id=$2::uuid AND field_key=$3', [input.orgId, input.schemaId, input.fieldKey]),
      ]);
      const original = form.rows[0];
      const question = original?.definition.fields.find(field => field.key === input.fieldKey);
      if (!original || !question) throw new ScoutingHttpError(404, "This original form question is not available to your team.");
      if (original.type !== "match" || !officialComparisonForField(question).kind) throw new ScoutingHttpError(422, "This question is a scout observation, not a robot-level official check.");
      const checkingEnabled = policy.rows[0]?.enabled !== false;
      const scope = { orgId: input.orgId, eventKey: input.eventKey, schemaId: input.schemaId, fieldKey: input.fieldKey, status: input.status, checkingEnabled };
      if (!checkingEnabled) return { ...scope, reports: [], nextCursor: null };
      const result = await client.query<QualityReportPage["reports"][number]>(
        `SELECT v.id AS "validationId",e.id AS "entryId",e.match_key AS "matchKey",e.team_key AS "teamKey",
                COALESCE(u.name,'Team scout') AS "scoutName",e.source,v.status,
                v.scout_value AS "scoutValue",v.official_value AS "officialValue",
                to_char(v.checked_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "checkedAt",
                to_char(e.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "updatedAt"
         FROM scout_entry_validations v JOIN match_scout_entries e ON e.id=v.entry_id AND e.org_id=v.org_id
         JOIN users u ON u.id=e.scout_user_id
         WHERE v.org_id=$1::uuid AND e.event_key=$2 AND e.schema_id=$3::uuid AND v.field_key=$4
           AND v.official_source='tba' AND v.status IN ('match','conflict')
           AND (v.detail LIKE '[robot-check-v3] %' OR v.detail LIKE 'Video re-scout: [robot-check-v3] %')
           AND ($5::text='all' OR v.status='conflict')
           AND ($6::timestamptz IS NULL OR (v.checked_at,v.id)<($6::timestamptz,$7::uuid))
         ORDER BY v.checked_at DESC,v.id DESC LIMIT $8`,
        [input.orgId, input.eventKey, input.schemaId, input.fieldKey, input.status, input.beforeCheckedAt ?? null, input.beforeValidationId ?? null, QUALITY_REPORT_PAGE_SIZE + 1]);
      const reports = result.rows.slice(0, QUALITY_REPORT_PAGE_SIZE);
      const last = reports.at(-1);
      return { ...scope, reports, nextCursor: result.rows.length > QUALITY_REPORT_PAGE_SIZE && last ? { checkedAt: last.checkedAt, validationId: last.validationId } : null };
    });
    return Response.json(data, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    const response = error instanceof RequestSecurityError ? Response.json({ error: error.message }, { status: error.status }) :
      error instanceof ScoutingHttpError ? scoutingErrorResponse(error) : Response.json({ error: "Report checks are temporarily unavailable. Refresh to try again." }, { status: 503 });
    response.headers.set("cache-control", "private, no-store");
    return response;
  }
}
