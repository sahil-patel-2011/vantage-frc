import {
  ScoutingHttpError,
  scoutingErrorResponse,
  withScoutingRequest,
} from "../../../../lib/scouting-auth";
import {
  distributeByShare,
  reconcileEvent,
  type DistributeByShareResult,
  type ReconcileEntry,
  type ReconcileMatchRow,
  type ReconciledMatch,
} from "../../../../lib/scouting/reconcile";
import type { OrgValueFormula } from "../../../../lib/scouting/scouted-ratings";
import { z } from "zod";
import { coverageEventKey } from "../../../../lib/scouting/coverage-request";
import { RequestSecurityError } from "../../../../lib/security/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function setupRequired(message: string) {
  return {
    status: "setup_required" as const,
    eventKey: null,
    generatedAt: new Date().toISOString(),
    message,
  };
}

function text(value: string | null, maximum = 80): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, maximum);
  return trimmed || null;
}

type ReconciledMatchWithShares = ReconciledMatch & {
  /** Per-robot split of the official total, only where every robot was scouted. */
  distribution: { red: DistributeByShareResult; blue: DistributeByShareResult };
};

/**
 * Scouted-vs-TBA reconciliation for the active event: our scouts' summed
 * alliance estimates against the official `matches_ref.score_breakdown` totals.
 * Read-only, RLS-scoped, and honest — no event, no breakdown, or no scouting
 * numbers all return a setup/empty state instead of invented deltas.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const orgId = text(url.searchParams.get("orgId"), 64);
  const eventOverride = text(url.searchParams.get("eventKey"), 120);

  try {
    if (!z.string().uuid().safeParse(url.searchParams.get("orgId")).success) throw new RequestSecurityError(400, "Choose a valid team.");
    const rawEvent = url.searchParams.get("eventKey");
    if (rawEvent !== null && !coverageEventKey.safeParse(rawEvent).success) throw new RequestSecurityError(400, "Choose a valid event.");
    const view = await withScoutingRequest(orgId, async (client) => {
      // withScoutingRequest already rejected a missing org; this narrows the type.
      if (!orgId) throw new ScoutingHttpError(400, "orgId is required");
      const context = await client.query<{ eventKey: string | null }>(
        `SELECT active_event_key AS "eventKey" FROM org_active_context WHERE org_id = $1::uuid`,
        [orgId],
      );
      const eventKey = eventOverride ?? context.rows[0]?.eventKey ?? null;
      if (!eventKey) {
        return setupRequired(
          "Pick your event on Event day. This compares your scouting to that event's official scores.",
        );
      }

      const [matches, entries, formulas] = await Promise.all([
        client.query<ReconcileMatchRow>(
          `SELECT match_key AS "matchKey", match_number AS "matchNumber",
                  comp_level AS "compLevel", red_alliance AS "redAlliance",
                  blue_alliance AS "blueAlliance", score_breakdown AS "scoreBreakdown"
             FROM matches_ref
            WHERE event_key = $1::text
              AND comp_level = 'qm'
              AND winning_alliance IS NOT NULL
            ORDER BY match_number`,
          [eventKey],
        ),
        client.query<ReconcileEntry>(
          `SELECT e.id::text AS "entryId", e.match_key AS "matchKey", e.team_key AS "teamKey",
                  e.scout_user_id::text AS "scoutUserId",
                  COALESCE(u.name, 'Team scout') AS "scoutName", e.payload
             FROM match_scout_entries e
             LEFT JOIN users u ON u.id = e.scout_user_id
            WHERE e.org_id = $1::uuid AND e.event_key = $2::text`,
          [orgId, eventKey],
        ),
        client.query<OrgValueFormula>(`SELECT name, expression FROM org_value_formulas WHERE org_id = $1::uuid ORDER BY name`, [orgId]),
      ]);

      if (!matches.rows.length) {
        return {
          ...setupRequired(
            "No qualification match has an official result yet. This starts once results are posted.",
          ),
          eventKey,
        };
      }

      const report = reconcileEvent({
        matches: matches.rows,
        entries: entries.rows,
        formulas: formulas.rows,
      });

      const withShares: ReconciledMatchWithShares[] = report.matches.map((match) => ({
        ...match,
        // Split what the ROBOTS scored — foul points were not theirs to earn.
        distribution: {
          red: distributeByShare(match.red.officialScoringTotal, match.red.robots),
          blue: distributeByShare(match.blue.officialScoringTotal, match.blue.robots),
        },
      }));

      return {
        status: "live" as const,
        eventKey,
        generatedAt: new Date().toISOString(),
        reviewDeltaPct: report.reviewDeltaPct,
        summary: report.summary,
        scoutedEntries: entries.rows.length,
        truncated: report.matches.length > withShares.length,
        matches: withShares,
      };
    });
    return Response.json({ ...view, orgId }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const response = error instanceof RequestSecurityError ? Response.json({ error: error.message }, { status: error.status }) :
      error instanceof ScoutingHttpError ? scoutingErrorResponse(error) :
      Response.json({ error: "Alliance review is temporarily unavailable. Refresh to try again." }, { status: 503 });
    response.headers.set("cache-control", "private, no-store");
    return response;
  }
}
