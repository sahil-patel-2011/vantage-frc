import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { isMatchForecastSkip } from "@vantage/prediction-strategy";
import { forecastActiveMatch } from "../../../../lib/strategy/card-forecast";
import { eventStartIso } from "../../../../lib/strategy/card-strength";
import { headers } from "next/headers";
import { seasonYearFromEventKey } from "../../../../lib/dashboard/score-from-metrics";
import { loadEventScoring } from "../../../../lib/opr/alliance-results";
import { maybeAdjustMatchForecast, predictionAiRequested } from "../../../../lib/strategy/prediction-ai";

const off = () => Response.json({ enabled: false, measured: false, aiUsed: false, note: null });

function teamKeys(alliance: unknown): string[] {
  if (!alliance || typeof alliance !== "object") return [];
  const keys = (alliance as { teamKeys?: unknown }).teamKeys;
  return Array.isArray(keys) ? keys.map(String) : [];
}

/**
 * Background step for a match the page has already predicted.
 * While the switch is off this returns immediately and does not open a model call.
 * When it is on, the model is the org's configured chat adapter (any provider).
 */
export async function POST(request: Request) {
  if (!predictionAiRequested()) return off();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Your session ended. Sign in again." }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const orgId = typeof body.orgId === "string" ? body.orgId : "";
  const matchKey = typeof body.matchKey === "string" ? body.matchKey : "";
  const notes = typeof body.notes === "string" ? body.notes : "";
  if (!orgId || !matchKey) return Response.json({ error: "Missing match" }, { status: 400 });

  try {
    const result = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const match = await client.query<{ eventKey: string; compLevel: string; redAlliance: unknown; blueAlliance: unknown }>(
        `SELECT m.event_key AS "eventKey", m.comp_level AS "compLevel",
                m.red_alliance AS "redAlliance", m.blue_alliance AS "blueAlliance"
         FROM matches_ref m WHERE m.match_key = $1 LIMIT 1`,
        [matchKey],
      );
      const row = match.rows[0];
      const year = row ? seasonYearFromEventKey(row.eventKey) : null;
      if (!row || !year) return { enabled: true, measured: false, aiUsed: false, note: null };
      const dated = await client.query<{ startDate: Date | string | null }>(
        `SELECT start_date AS "startDate" FROM events_ref WHERE event_key = $1`,
        [row.eventKey],
      );
      const scoring = await loadEventScoring(client, row.eventKey);
      const forecast = forecastActiveMatch({
        season: year,
        eventKey: row.eventKey,
        startDate: eventStartIso(dated.rows[0]?.startDate),
        level: row.compLevel,
        red: teamKeys(row.redAlliance),
        blue: teamKeys(row.blueAlliance),
        played: scoring.samples,
      });
      if (isMatchForecastSkip(forecast)) return { enabled: true, measured: false, aiUsed: false, note: null };
      const adjusted = await maybeAdjustMatchForecast({
        client,
        orgId,
        userId: session.user.id,
        forecast,
        notes,
      });
      return {
        enabled: true,
        measured: false,
        aiUsed: adjusted.aiUsed,
        note: adjusted.note,
        red: adjusted.forecast.red.total,
        blue: adjusted.forecast.blue.total,
        redWinProbability: adjusted.forecast.redWinProbability,
      };
    });
    return Response.json(result);
  } catch {
    return Response.json({ enabled: true, measured: false, aiUsed: false, note: null });
  }
}
