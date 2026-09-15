import { IntelResearchRepository } from "@vantage/intel-research/repository";
import { intelErrorResponse, withIntelRequest } from "../../../../lib/intel-auth";
import type { EventRatingRow } from "../../../../lib/intel/lovat-lookup";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    const query = url.searchParams.get("q")?.trim();
    const teamNumber = Number(url.searchParams.get("team"));
    return Response.json(
      await withIntelRequest(orgId, async (client) => {
        const repository = new IntelResearchRepository(client);
        const activeEvent = await repository.getActiveEvent(orgId!);
        if (Number.isInteger(teamNumber) && teamNumber > 0) {
          const intel = await repository.getTeamIntel(orgId!, teamNumber);
          if (!intel) return { team: null, activeEvent };
          const [observations, similarTeams, field] = await Promise.all([
            repository.getScoutObservations(orgId!, intel.team.teamKey),
            repository.getSimilarTeams(intel.team.teamKey),
            activeEvent?.eventKey
              ? client
                  .query<EventRatingRow>(
                    `SELECT DISTINCT ON (m.team_key)
                        m.team_key AS "teamKey",
                        m.epa_total AS "epaTotal",
                        m.epa_auto AS "epaAuto",
                        m.epa_teleop AS "epaTeleop",
                        m.epa_endgame AS "epaEndgame",
                        m.rank, m.wins, m.opr, m.dpr, m.ccwm
                     FROM team_event_metrics m
                     WHERE m.event_key = $1::text
                     ORDER BY m.team_key,
                       CASE m.source WHEN 'statbotics' THEN 0 WHEN 'tba' THEN 1 ELSE 2 END,
                       m.synced_at DESC NULLS LAST`,
                    [activeEvent.eventKey],
                  )
                  .catch(() => ({ rows: [] as EventRatingRow[] }))
              : Promise.resolve({ rows: [] as EventRatingRow[] }),
          ]);
          return {
            team: intel,
            scoutObservations: observations,
            similarTeams,
            activeEvent,
            fieldRatings: field.rows,
          };
        }
        if (!query) return { teams: [], activeEvent };
        return { teams: await repository.searchTeams(orgId!, query), activeEvent };
      }),
    );
  } catch (error) {
    return intelErrorResponse(error);
  }
}
