import { allianceChemistry, headToHead } from "@vantage/intel-research";
import { IntelResearchRepository } from "@vantage/intel-research/repository";
import { intelErrorResponse, withIntelRequest } from "../../../../lib/intel-auth";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { orgId?: string; teamNumbers?: number[] };
    const teamNumbers = [...new Set(body.teamNumbers ?? [])].slice(0, 3);
    if (teamNumbers.length < 2 || teamNumbers.some((number) => !Number.isInteger(number)))
      return Response.json({ error: "Two or three team numbers are required" }, { status: 400 });
    const result = await withIntelRequest(body.orgId ?? null, async (client) => {
      const repository = new IntelResearchRepository(client);
      const teams = await Promise.all(
        teamNumbers.map((number) => repository.getTeamIntel(body.orgId!, number)),
      );
      if (teams.some((team) => !team)) throw new Error("One or more teams were not found");
      const resolved = teams.map((team) => team!);
      const latest = resolved.map((team) => team.metrics[0]);
      return {
        teams: resolved.map((team) => team.team),
        headToHead: headToHead(latest[0], latest[1]),
        chemistry: allianceChemistry(latest.filter((metric) => metric !== undefined)),
      };
    });
    return Response.json(result);
  } catch (error) {
    return intelErrorResponse(error);
  }
}
