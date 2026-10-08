import type { SchemaDefinition } from "@vantage/scouting";
import { auth } from "@vantage/core";
import { headers } from "next/headers";
import { freeScoutDefinition, portableScoutDefinition, parseFreeScoutReport, UUID_PATTERN } from "../../../../lib/scouting/free-scout";
import { ScoutingHttpError, scoutingErrorResponse, withScoutingRequest } from "../../../../lib/scouting-auth";
import { z } from "zod";
import { parseSecureJson, RequestSecurityError, securityErrorResponse } from "../../../../lib/security/request";

const reportRequest = z.object({ orgId: z.string().uuid(), userId: z.string().uuid(), report: z.unknown() }).strict();
const deleteRequest = z.object({ orgId: z.string().uuid(), id: z.string().uuid() }).strict();

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
    const body = await parseSecureJson(request, reportRequest, { maxBytes: 524_288 });
    const submitted = body.report && typeof body.report === "object" && !Array.isArray(body.report)
      ? body.report as Record<string, unknown> : null;
    if (body.userId !== session.user.id) throw new ScoutingHttpError(403, "Sign in with the account that saved this report.");
    let savedId = "";
    await withScoutingRequest(body.orgId, async (client) => {
      let definition: SchemaDefinition | undefined;
      if (submitted?.schemaId) {
        if (!UUID_PATTERN.test(String(submitted.schemaId))) throw new ScoutingHttpError(400, "Form ID is invalid.");
        const schema = await client.query<{ definition: SchemaDefinition }>(
          'SELECT schema AS definition FROM scout_schemas WHERE id=$1 AND org_id=$2 AND year=$3 AND type=$4',
          [submitted.schemaId, body.orgId, submitted.year, submitted.type],
        );
        if (!schema.rows[0]) throw new ScoutingHttpError(422, "This form is unavailable for this team and game. Your local report was kept.");
        definition = portableScoutDefinition(schema.rows[0].definition);
      }
      const report = parseFreeScoutReport(body.report, definition);
      savedId = report.id;
      // Corrections retain identity and questions. Older retries cannot replace a
      // newer correction, and another author cannot receive its acknowledgement.
      const inserted = await client.query(
        `INSERT INTO free_scout_reports (id,org_id,scout_user_id,year,type,team_number,label,definition,payload,observed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::timestamptz)
         ON CONFLICT (id) DO UPDATE SET payload=excluded.payload, observed_at=excluded.observed_at
         WHERE free_scout_reports.org_id=excluded.org_id AND free_scout_reports.scout_user_id=excluded.scout_user_id
           AND free_scout_reports.year=excluded.year AND free_scout_reports.type=excluded.type
           AND free_scout_reports.team_number=excluded.team_number AND free_scout_reports.label=excluded.label
           AND free_scout_reports.definition=excluded.definition
           AND free_scout_reports.observed_at <= excluded.observed_at
         RETURNING id`,
        [report.id, body.orgId, session.user.id, report.year, report.type, report.teamNumber, report.label,
          JSON.stringify(definition ?? freeScoutDefinition(report.year, report.type)), JSON.stringify(report.payload), report.observedAt],
      );
      if (!inserted.rowCount) {
        const existing = await client.query(
          `SELECT id FROM free_scout_reports WHERE id=$1 AND org_id=$2 AND scout_user_id=$3
           AND year=$4 AND type=$5 AND team_number=$6 AND label=$7 AND observed_at >= $8::timestamptz AND definition=$9::jsonb`,
          [report.id, body.orgId, session.user.id, report.year, report.type, report.teamNumber, report.label, report.observedAt, JSON.stringify(definition ?? freeScoutDefinition(report.year, report.type))],
        );
        if (!existing.rowCount) throw new ScoutingHttpError(409, "This report ID is already in use. Your local report was kept.");
      }
    });
    return Response.json({ id: savedId });
  } catch (error) {
    if (error instanceof RequestSecurityError) return securityErrorResponse(error, "Could not save this report.");
    return scoutingErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await parseSecureJson(request, deleteRequest, { maxBytes: 4096 });
    if (typeof body.id !== "string" || !UUID_PATTERN.test(body.id)) throw new ScoutingHttpError(400, "Report ID is invalid.");
    await withScoutingRequest(body.orgId, async (client) => {
      const result = await client.query("DELETE FROM free_scout_reports WHERE id=$1 AND org_id=$2 RETURNING id", [body.id, body.orgId]);
      if (!result.rowCount) throw new ScoutingHttpError(403, "Only the author or a scouting lead can delete this report.");
    });
    return Response.json({ deleted: true });
  } catch (error) {
    if (error instanceof RequestSecurityError) return securityErrorResponse(error, "Could not delete this report.");
    return scoutingErrorResponse(error);
  }
}
