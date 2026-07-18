import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { buildEngineeringBriefFromTools, type EngineeringBrief } from "./brief-from-tools";
import { planChatToolCalls } from "./auto-tools";
import { AIOrchestrator, type ContextSource } from "./orchestrator";
import { createVantageToolRegistry } from "./tools";

export type ChatAdapterLite = {
  readonly provider: string;
  readonly model: string;
  complete(input: {
    message: string;
    context: Array<{ type: string; id: string; content: string; importance: number }>;
    promptCachingEnabled?: boolean;
  }): Promise<{
    text: string;
    promptTokens: number;
    completionTokens: number;
    costUsd: number;
  }>;
};

class BriefAdapter implements ChatAdapterLite {
  readonly provider = "local";
  readonly model = "vantage-cad-brief-v1";
  constructor(
    private readonly sourceRefs: EngineeringBrief["sourceRefs"],
    private readonly knowledgeNotes: string[] = [],
  ) {}
  async complete(input: {
    message: string;
    context: Array<{ type: string; id: string; content: string; importance: number }>;
  }) {
    const brief = buildEngineeringBriefFromTools({
      request: input.message,
      context: input.context as Parameters<typeof buildEngineeringBriefFromTools>[0]["context"],
      sourceRefs: this.sourceRefs,
      knowledgeNotes: this.knowledgeNotes,
    });
    const text = JSON.stringify(brief);
    return {
      text,
      promptTokens: Math.ceil(text.length / 4),
      completionTokens: Math.ceil(text.length / 4),
      costUsd: 0,
    };
  }
}

export const CAD_BRIEF_TOOL_NAMES = [
  "strategy.match",
  "strategy.design",
  "kickoff.intelligence",
  "kickoff.rules",
  "rules.compliance",
  "fmea.open_risks",
  "fmea.repeat",
  "cad.briefs",
  "knowledge.search",
  "knowledge.get_page",
] as const;

/** CAD pulls strategy.match + kickoff design priorities + FMEA risks from the shared tool graph. */
export function planCadStrategyToolCalls(
  request: string,
  options: { matchKey?: string; seasonYear?: number; activeEventKey?: string | null } = {},
) {
  const seasonYear = options.seasonYear ?? new Date().getUTCFullYear();
  const planned = planChatToolCalls(request, {
    capability: "cad",
    selected: options.matchKey ? { matchKey: options.matchKey } : undefined,
    seasonYear,
    activeEventKey: options.activeEventKey,
  });
  const preferred = planned.filter((call) =>
    (CAD_BRIEF_TOOL_NAMES as readonly string[]).includes(call.name),
  );
  if (preferred.length) return preferred.slice(0, 10);
  const fallback: Array<{ name: string; input: unknown }> = [
    { name: "kickoff.intelligence", input: { seasonYear } },
    { name: "strategy.design", input: { seasonYear } },
    { name: "kickoff.rules", input: { seasonYear } },
    { name: "fmea.open_risks", input: { seasonYear, limit: 12 } },
    { name: "rules.compliance", input: { proposal: request.trim().slice(0, 8_000), seasonYear } },
  ];
  if (options.matchKey) fallback.unshift({ name: "strategy.match", input: { matchKey: options.matchKey } });
  return fallback;
}

export type CreateMeteredCadBriefInput = {
  orgId: string;
  userId: string;
  threadId?: string;
  requestId?: string;
  title: string;
  request: string;
  sources?: ContextSource[];
  platform?: "onshape" | "fusion360" | "mock";
  executionMode?: "hosted" | "local";
  selected?: { teamKey?: string; matchKey?: string };
  seasonYear?: number;
};

/** Metered CAD brief grounded in strategy / kickoff / FMEA / knowledge tools. */
export async function createMeteredCadBriefJob(client: PoolClient, input: CreateMeteredCadBriefInput) {
  const active =
    (
      await client.query<{ active_event_key: string | null }>(
        `SELECT active_event_key FROM org_active_context WHERE org_id=$1`,
        [input.orgId],
      )
    ).rows[0]?.active_event_key ?? null;
  const registry = createVantageToolRegistry();
  const strategyToolCalls = planCadStrategyToolCalls(input.request, {
    matchKey: input.selected?.matchKey,
    seasonYear: input.seasonYear,
    activeEventKey: active,
  }).filter((call) => call.name !== "cad.create_brief");

  const knowledgeNotes: string[] = [];
  for (const call of strategyToolCalls.filter((entry) => entry.name.startsWith("knowledge."))) {
    try {
      const output = await registry.invoke(
        call.name,
        { client, orgId: input.orgId, userId: input.userId, activeEventKey: active },
        call.input,
      );
      if (Array.isArray(output)) {
        for (const row of output as Array<Record<string, unknown>>) {
          const title = String(row.title ?? "");
          const snippet = String(row.snippet ?? "");
          const source = String(row.source ?? "wiki");
          if (!title) continue;
          knowledgeNotes.push(`${source}: ${title}${snippet ? ` — ${snippet}` : ""}`.slice(0, 280));
        }
      } else if (output && typeof output === "object") {
        const page = (output as { page?: Record<string, unknown> | null }).page;
        if (page) knowledgeNotes.push(`wiki: ${String(page.title ?? "")}`.slice(0, 280));
      }
    } catch {
      // Missing wiki — continue without inventing knowledge.
    }
  }

  const sources = input.sources ?? [];
  const sourceRefs = sources.map((source) => ({
    type: source.type,
    id: source.id,
    classification: source.classification,
  }));
  const requestId = input.requestId ?? `cad-brief-${randomUUID()}`;
  const orchestrated = await new AIOrchestrator(client, registry).run({
    orgId: input.orgId,
    userId: input.userId,
    threadId: input.threadId,
    requestId,
    capability: "cad",
    privacyScope: "team",
    message: input.request,
    adapter: new BriefAdapter(sourceRefs, knowledgeNotes) as never,
    contextSources: sources,
    selected: input.selected,
    autoTools: true,
    toolCalls: strategyToolCalls,
    usesOrgData: true,
  });

  const parsed = JSON.parse(orchestrated.text) as EngineeringBrief;
  const result = await client.query<{ id: string }>(
    `INSERT INTO cad_jobs(org_id,created_by,thread_id,execution_mode,platform,title,brief,status)
     VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,'awaiting_brief_confirmation') RETURNING id`,
    [
      input.orgId,
      input.userId,
      input.threadId ?? null,
      input.executionMode ?? "hosted",
      input.platform ?? "mock",
      input.title,
      JSON.stringify(parsed),
    ],
  );
  const jobId = result.rows[0]!.id;
  const aiArtifact = await new AIOrchestrator(client).createArtifact({
    runId: orchestrated.runId,
    orgId: input.orgId,
    userId: input.userId,
    threadId: input.threadId,
    kind: "cad_brief",
    title: input.title,
    content: parsed as unknown as Record<string, unknown>,
    claims: parsed.sourceRefs.map((ref) => ({
      claim: `Source used: ${ref.id}`,
      classification:
        ref.classification === "hard_metric"
          ? ("hard_metric" as const)
          : ref.classification === "scout_observation"
            ? ("scout_observation" as const)
            : ref.classification === "researched_claim"
              ? ("researched_claim" as const)
              : ("model_inference" as const),
      sourceIds: [ref.id],
    })),
  });
  const checksum = createHash("sha256").update(JSON.stringify(parsed)).digest("hex");
  await client.query(
    `INSERT INTO cad_artifacts(org_id,job_id,type,title,content,checksum,source_refs,created_by)
     VALUES($1,$2,'engineering_brief',$3,$4::jsonb,$5,$6::jsonb,$7)`,
    [
      input.orgId,
      jobId,
      input.title,
      JSON.stringify({ ...parsed, aiArtifactId: aiArtifact.id }),
      checksum,
      JSON.stringify(parsed.sourceRefs),
      input.userId,
    ],
  );
  await client.query(
    `INSERT INTO cad_audit_events(org_id,job_id,actor_user_id,action,payload) VALUES($1,$2,$3,$4,$5::jsonb)`,
    [
      input.orgId,
      jobId,
      input.userId,
      "cad.brief.created",
      JSON.stringify({
        aiRunId: orchestrated.runId,
        aiArtifactId: aiArtifact.id,
        strategyTools: strategyToolCalls.map((c) => c.name),
        toolStatuses: orchestrated.toolOutputs.map((t) => ({ name: t.name, status: t.status })),
      }),
    ],
  );
  return {
    jobId,
    brief: parsed,
    aiRunId: orchestrated.runId,
    aiArtifactId: aiArtifact.id,
    tools: orchestrated.toolOutputs,
    status: "awaiting_brief_confirmation" as const,
  };
}
