import { IntelResearchRepository } from "@vantage/intel-research/repository";
import { intelErrorResponse, withIntelRequest } from "../../../../lib/intel-auth";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    const query = url.searchParams.get("q")?.trim();
    const teamNumber = Number(url.searchParams.get("team"));
    return Response.json(
      await withIntelRequest(orgId, async (client) => {
        const repository = new IntelResearchRepository(client);
        if (Number.isInteger(teamNumber) && teamNumber > 0) {
          const intel = await repository.getTeamIntel(orgId!, teamNumber);
          if (!intel) return { team: null };
          const [observations, similarTeams] = await Promise.all([
            repository.getScoutObservations(orgId!, intel.team.teamKey),
            repository.getSimilarTeams(intel.team.teamKey),
          ]);
          return { team: intel, scoutObservations: observations, similarTeams };
        }
        if (!query) return { teams: [] };
        return { teams: await repository.searchTeams(orgId!, query) };
      }),
    );
  } catch (error) {
    return intelErrorResponse(error);
  }
}
