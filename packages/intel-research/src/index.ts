import { randomUUID } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { AIOrchestrator,type ChatAdapter,type ContextSource } from "@vantage/agent";
import type { SummaryProvider } from "./types";

export * from "./analytics";
export * from "./providers";
export * from "./student-copy";
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
  const adapter:ChatAdapter={provider:input.provider.name,model:input.provider.name==="local-deterministic"?"vantage-local-summary-v1":input.provider.name,complete:async()=>{
      const receipt = await input.provider.summarize(input.context);
      return {
        text: receipt.text,
        promptTokens: receipt.promptTokens,
        completionTokens: receipt.completionTokens,
        costUsd: receipt.costUsd,
      };
  }};
  const sources:ContextSource[]=[
    ...input.context.metrics.map((metric,index)=>({type:"module_data" as const,id:`metric:${input.teamNumber}:${index}`,content:JSON.stringify(metric),importance:1,classification:"hard_metric" as const})),
    ...input.context.scoutObservations.map((observation,index)=>({type:"module_data" as const,id:`scout:${input.teamNumber}:${index}`,content:JSON.stringify(observation),importance:.9,classification:"scout_observation" as const})),
    ...input.context.findings.map((finding,index)=>({type:"module_data" as const,id:finding.id??`finding:${input.teamNumber}:${index}`,content:finding.summary,importance:finding.confidence,classification:"researched_claim" as const,sourceUrl:finding.sourceUrl,observedAt:new Date(finding.foundAt).toISOString()})),
  ];
  return(await new AIOrchestrator(input.client).run({orgId:input.orgId,userId:input.userId,requestId:input.requestId??randomUUID(),capability:"team_intel",privacyScope:"private",message:`Summarize team ${input.teamNumber} using cited evidence.`,adapter,contextSources:sources,selected:{teamKey:`frc${input.teamNumber}`}})).text;
}
