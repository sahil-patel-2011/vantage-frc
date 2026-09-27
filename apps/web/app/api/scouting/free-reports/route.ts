import { auth } from "@vantage/core";
import { headers } from "next/headers";
import { freeScoutDefinition, parseFreeScoutReport, UUID_PATTERN } from "../../../../lib/scouting/free-scout";
import { ScoutingHttpError, scoutingErrorResponse, withScoutingRequest } from "../../../../lib/scouting-auth";

export async function GET(request: Request) {
  try {
    const orgId = new URL(request.url).searchParams.get("orgId");
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new ScoutingHttpError(401, "Sign in to scout.");
    const reports = await withScoutingRequest(orgId, async (client) => {
      const result = await client.query(
        `SELECT id, year, type, team_number AS "teamNumber", label, definition, payload,
          observed_at AS "observedAt", scout_user_id AS "scoutUserId"
         FROM free_scout_reports WHERE org_id=$1 ORDER BY created_at DESC LIMIT 201`, [orgId],
      );
      return result.rows;
    });
    return Response.json({ userId: session.user.id, reports: reports.slice(0, 200), hasMore: reports.length > 200 }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return scoutingErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new ScoutingHttpError(401, "Sign in to scout.");
    const body = await request.json();
    if (body.userId !== session.user.id) throw new ScoutingHttpError(403, "Sign in with the account that saved this report.");
    const report = parseFreeScoutReport(body.report);
    await withScoutingRequest(body.orgId, async (client) => {
      // Immutable submissions make interrupted/repeated uploads safe. Only the same author
      // can receive an acknowledgement for an existing ID, including on a shared device.
      const inserted = await client.query(
        `INSERT INTO free_scout_reports (id,org_id,scout_user_id,year,type,team_number,label,definition,payload,observed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::timestamptz)
         ON CONFLICT (id) DO NOTHING RETURNING id`,
        [report.id, body.orgId, session.user.id, report.year, report.type, report.teamNumber, report.label,
          JSON.stringify(freeScoutDefinition(report.year, report.type)), JSON.stringify(report.payload), report.observedAt],
      );
      if (!inserted.rowCount) {
        const existing = await client.query(
          `SELECT id FROM free_scout_reports WHERE id=$1 AND org_id=$2 AND scout_user_id=$3
           AND year=$4 AND type=$5 AND team_number=$6 AND label=$7 AND payload=$8::jsonb AND observed_at=$9::timestamptz`,
          [report.id, body.orgId, session.user.id, report.year, report.type, report.teamNumber, report.label, JSON.stringify(report.payload), report.observedAt],
        );
        if (!existing.rowCount) throw new ScoutingHttpError(409, "This report ID is already in use. Your local report was kept.");
      }
    });
    return Response.json({ id: report.id });
  } catch (error) { return scoutingErrorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json();
    if (typeof body.id !== "string" || !UUID_PATTERN.test(body.id)) throw new ScoutingHttpError(400, "Report ID is invalid.");
    await withScoutingRequest(body.orgId, async (client) => {
      const result = await client.query("DELETE FROM free_scout_reports WHERE id=$1 AND org_id=$2 RETURNING id", [body.id, body.orgId]);
      if (!result.rowCount) throw new ScoutingHttpError(403, "Only the author or a team admin can delete this report.");
    });
    return Response.json({ deleted: true });
  } catch (error) { return scoutingErrorResponse(error); }
}
