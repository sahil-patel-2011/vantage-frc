import { createSearchProvider } from "@vantage/intel-research";
import { IntelResearchRepository } from "@vantage/intel-research/repository";
import { runMeteredOnDemandResearch } from "@vantage/intel-research/worker";
import { intelErrorResponse, withIntelRequest } from "../../../lib/intel-auth";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { orgId?: string; teamNumber?: number };
    if (!Number.isInteger(body.teamNumber) || body.teamNumber! < 1)
      return Response.json({ error: "Valid teamNumber is required" }, { status: 400 });
    const value = await withIntelRequest(body.orgId ?? null, async (client) => {
      const repository = new IntelResearchRepository(client);
      const intel = await repository.getTeamIntel(body.orgId!, body.teamNumber!);
      if (!intel) throw new Error("Team not found");
      const user = await client.query<{ id: string }>("SELECT current_app_user_id() AS id");
      const jobId = await repository.queueOnDemand(
        body.orgId!,
        user.rows[0]!.id,
        intel.team.teamKey,
      );
      const result = await runMeteredOnDemandResearch({
        client,
        orgId: body.orgId!,
        userId: user.rows[0]!.id,
        jobId,
        requestId: crypto.randomUUID(),
        provider: createSearchProvider(),
      });
      return { jobId, ...result };
    });
    return Response.json(value, { status: 201 });
  } catch (error) {
    return intelErrorResponse(error);
  }
}
