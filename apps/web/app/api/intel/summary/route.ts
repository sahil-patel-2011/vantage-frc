import {
  generateMeteredTeamSummary,
  LocalSummaryProvider,
} from "@vantage/intel-research";
import { IntelResearchRepository } from "@vantage/intel-research/repository";
import { intelErrorResponse, withIntelRequest } from "../../../../lib/intel-auth";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { orgId?: string; teamNumber?: number };
    if (!Number.isInteger(body.teamNumber) || body.teamNumber! < 1)
      return Response.json({ error: "Valid teamNumber is required" }, { status: 400 });
    const result = await withIntelRequest(body.orgId ?? null, async (client) => {
      const repository = new IntelResearchRepository(client);
      const intel = await repository.getTeamIntel(body.orgId!, body.teamNumber!);
      if (!intel) throw new Error("Team not found");
      const observations = await repository.getScoutObservations(
        body.orgId!,
        intel.team.teamKey,
      );
      const user = await client.query<{ id: string }>(
        "SELECT current_app_user_id() AS id",
      );
      const summary = await generateMeteredTeamSummary({
        client,
        orgId: body.orgId!,
        userId: user.rows[0]!.id,
        teamNumber: body.teamNumber!,
        provider: new LocalSummaryProvider(),
        context: {
          teamNumber: intel.team.teamNumber,
          nickname: intel.team.nickname,
          metrics: intel.metrics,
          findings: intel.findings,
          scoutObservations: observations,
        },
      });
      return { summary };
    });
    return Response.json(result);
  } catch (error) {
    return intelErrorResponse(error);
  }
}
