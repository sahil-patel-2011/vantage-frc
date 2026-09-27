import {
  intelErrorResponse,
  IntelHttpError,
  withIntelRequest,
} from "../../../../lib/intel-auth";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const orgId = params.get("orgId");
    const teamKey = params.get("teamKey");
    const eventKey = params.get("eventKey");
    if (!teamKey || !/^frc\d+[a-z]?$/i.test(teamKey) || !eventKey)
      throw new IntelHttpError(400, "Choose a robot and event.");
    const data = await withIntelRequest(orgId, async (client) => {
      const result = await client.query(
        `SELECT source_org_id AS "sourceOrgId", source_team_number AS "sourceTeamNumber",schema_id AS "schemaId",
          schema_version AS "schemaVersion", match_key AS "matchKey",event_key AS "eventKey", confidence,payload,fields
          FROM get_shared_scout_observations($1::uuid,$2,$3)`,
        [orgId, teamKey, eventKey],
      );
      return {
        rows: result.rows.slice(0, 2000),
        truncated: result.rows.length > 2000,
      };
    });
    return Response.json(data, {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    return intelErrorResponse(error);
  }
}
