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
import { loadScoutFieldRoles } from "../../../../lib/strategy/scout-field-roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Keeps the response small on a full 80-qual event without hiding the flags. */
const MAX_MATCHES = 40;

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
  const eventOverride = text(url.searchParams.get("eventKey"), 80);

  try {
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
          "Set an active event in Event Day — reconciliation compares your scouting to that event's official score breakdowns.",
        );
      }

      const [matches, entries, roles] = await Promise.all([
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
        loadScoutFieldRoles(client, orgId, eventKey),
      ]);

      if (!matches.rows.length) {
        return {
          ...setupRequired(
            "No played qualification match is cached for this event yet — reconciliation starts once official results are published.",
          ),
          eventKey,
        };
      }

      const report = reconcileEvent({
        matches: matches.rows,
        entries: entries.rows,
        roles,
      });

      const withShares: ReconciledMatchWithShares[] = report.matches
        .slice(0, MAX_MATCHES)
        .map((match) => ({
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
    return Response.json(view, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    // Auth / org-access failures stay real errors so the client can offer sign-in.
    if (error instanceof ScoutingHttpError) return scoutingErrorResponse(error);
    // No database (or schema not migrated yet): honest setup state, never a crash.
    return Response.json(
      setupRequired(
        "Reconciliation needs the team database. Confirm the team is provisioned, then set an active event in Event Day.",
      ),
      { status: 200, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
