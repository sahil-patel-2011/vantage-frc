import { randomUUID } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { meteredAI } from "@vantage/billing";
import type { SummaryProvider } from "./types";

export * from "./analytics";
export * from "./providers";
export * from "./types";
export { IntelResearchRepository } from "./repository";

export async function generateMeteredTeamSummary(input: {
  client: PoolClient;
  orgId: string;
  userId: string;
  teamNumber: number;
  provider: SummaryProvider;
  requestId?: string;
  context: Parameters<SummaryProvider["summarize"]>[0];
}) {
  return meteredAI({
    client: input.client,
    orgId: input.orgId,
    userId: input.userId,
    feature: "team_summary",
    requestId: input.requestId ?? randomUUID(),
    estimatedCostUsd: 0.01,
    metadata: { teamNumber: input.teamNumber },
    invoke: async () => {
      const receipt = await input.provider.summarize(input.context);
      return {
        value: receipt.text,
        promptTokens: receipt.promptTokens,
        completionTokens: receipt.completionTokens,
        costUsd: receipt.costUsd,
        model: receipt.model,
        provider: input.provider.name,
      };
    },
  });
}
