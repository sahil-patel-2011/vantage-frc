import { withScoutingRequest, scoutingErrorResponse } from "../../../../lib/scouting-auth";
import { evaluateRecordedPredictions, type MeasuredPrediction } from "../../../../lib/strategy/prediction-evaluation";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const orgId = new URL(request.url).searchParams.get("orgId");
    const result = await withScoutingRequest(orgId, async client => {
      const rows = await client.query<MeasuredPrediction>(
        `SELECT p.model_version AS "modelVersion", p.p_red AS probability, m.winning_alliance AS winner,
          p.scored_at AS "predictedAt", m.actual_time AS "startedAt"
         FROM predictions p JOIN matches_ref m ON m.match_key=p.match_key
         WHERE p.org_id=$1 AND m.actual_time IS NOT NULL AND p.scored_at<m.actual_time
           AND m.winning_alliance IN ('red','blue') ORDER BY m.actual_time DESC LIMIT 2000`, [orgId],
      );
      const rowsWithDates = rows.rows.map(row => ({ ...row, predictedAt: String(row.predictedAt), startedAt: String(row.startedAt) }));
      return { models: evaluateRecordedPredictions(rowsWithDates) };
    });
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return scoutingErrorResponse(error); }
}
