import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { buildEngineeringBriefFromTools, type EngineeringBrief } from "./brief-from-tools";
import { planChatToolCalls } from "./auto-tools";
import {
  AIOrchestrator,
  type AIToolRegistry,
  type ContextSource,
  type OrchestratorResult,
} from "./orchestrator";
import { createVantageToolRegistry } from "./tools";
import type { AnnotatedToolOutput } from "./auto-tools";
import { CROSS_FEATURE_TOOL_GRAPH, linkFeatureContext } from "./feature-context";
import { resolveActiveSeasonYear } from "./season-year";

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
    private readonly activeSeasonYear?: number,
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
      activeSeasonYear: this.activeSeasonYear,
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

export const CAD_BRIEF_TOOL_NAMES = CROSS_FEATURE_TOOL_GRAPH.cad_brief;

/** CAD pulls strategy.match + kickoff + FMEA + trusted scouting + knowledge from the shared tool graph. */
export function planCadStrategyToolCalls(
  request: string,
  options: {
    matchKey?: string;
    teamKey?: string;
    seasonYear?: number;
    activeEventKey?: string | null;
  } = {},
) {
  const seasonYear = resolveActiveSeasonYear({
    seasonYear: options.seasonYear,
    activeEventKey: options.activeEventKey,
    matchKey: options.matchKey,
  });
  const planned = planChatToolCalls(request, {
    capability: "cad",
    selected: {
      ...(options.matchKey ? { matchKey: options.matchKey } : {}),
      ...(options.teamKey ? { teamKey: options.teamKey } : {}),
    },
    seasonYear,
    activeEventKey: options.activeEventKey,
  });
  const preferred = planned.filter((call) =>
    (CAD_BRIEF_TOOL_NAMES as readonly string[]).includes(call.name),
  );
  if (options.teamKey && !preferred.some((call) => call.name === "scouting.team")) {
    preferred.push({ name: "scouting.team", input: { teamKey: options.teamKey } });
  }
  if (!preferred.some((call) => call.name === "scouting.schema")) {
    preferred.push({ name: "scouting.schema", input: { seasonYear } });
  }
  if (preferred.length) return preferred.slice(0, 12);
  const fallback: Array<{ name: string; input: unknown }> = [
    { name: "kickoff.intelligence", input: { seasonYear } },
    { name: "strategy.design", input: { seasonYear } },
    { name: "kickoff.rules", input: { seasonYear } },
    { name: "fmea.open_risks", input: { seasonYear, limit: 12 } },
    { name: "rules.compliance", input: { proposal: request.trim().slice(0, 8_000), seasonYear } },
    { name: "scouting.schema", input: { seasonYear } },
  ];
  if (options.matchKey) fallback.unshift({ name: "strategy.match", input: { matchKey: options.matchKey } });
  if (options.teamKey) fallback.push({ name: "scouting.team", input: { teamKey: options.teamKey } });
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
  teamProfile?: {
    defaultPlatform: "onshape" | "fusion360" | "mock";
    preferredUnits: "mm" | "in";
    manufacturingProcesses: string[];
    preferredMaterials: string[];
    standardComponents: string[];
    designRules: string[];
  };
  userPreferences?: { preferredUnits: "team" | "mm" | "in" };
  /**
   * When true (chat `cad.create_brief` nested invoke), skip a second meteredAI run —
   * parent orchestrator already meters the turn. Still writes the CAD job + context links.
   */
  inheritMetering?: boolean;
};

export type MeteredCadBriefJobResult = {
  jobId: string;
  brief: EngineeringBrief;
  aiRunId: string | null;
  aiArtifactId: string | null;
  tools: AnnotatedToolOutput[];
  status: "awaiting_brief_confirmation";
};

async function collectKnowledgeNotes(
  registry: AIToolRegistry,
  client: PoolClient,
  orgId: string,
  userId: string,
  active: string | null,
  toolCalls: Array<{ name: string; input: unknown }>,
) {
  const knowledgeNotes: string[] = [];
  for (const call of toolCalls.filter((entry) => entry.name.startsWith("knowledge."))) {
    try {
      const output = await registry.invoke(
        call.name,
        { client, orgId, userId, activeEventKey: active },
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
  return knowledgeNotes;
}

async function writeCadBriefContextLinks(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    jobId: string;
    requestId: string;
    title: string;
    selected?: { teamKey?: string; matchKey?: string };
    toolOutputs: AnnotatedToolOutput[];
  },
) {
  if (input.selected?.matchKey) {
    await linkFeatureContext(client, {
      orgId: input.orgId,
      userId: input.userId,
      sourceKind: "strategy_match",
      sourceId: input.selected.matchKey,
      targetKind: "cad_job",
      targetId: input.jobId,
      relation: "informs",
      metadata: { requestId: input.requestId, title: input.title },
    });
  }
  if (input.selected?.teamKey) {
    await linkFeatureContext(client, {
      orgId: input.orgId,
      userId: input.userId,
      sourceKind: "reference_team",
      sourceId: input.selected.teamKey,
      targetKind: "cad_job",
      targetId: input.jobId,
      relation: "informs",
      metadata: { requestId: input.requestId },
    });
  }
  const inventoryOutput = input.toolOutputs.find((tool) => tool.name === "inventory.availability")?.output;
  const inventoryItems =
    inventoryOutput && typeof inventoryOutput === "object" && !Array.isArray(inventoryOutput)
      ? ((inventoryOutput as { items?: Array<{ id?: unknown }> }).items ?? [])
      : [];
  for (const item of inventoryItems.slice(0, 20)) {
    const itemId = String(item.id ?? "").trim();
    if (!itemId) continue;
    await linkFeatureContext(client, {
      orgId: input.orgId,
      userId: input.userId,
      sourceKind: "inventory_item",
      sourceId: itemId,
      targetKind: "cad_job",
      targetId: input.jobId,
      relation: "supplies",
      metadata: { requestId: input.requestId },
    });
  }
  const fmeaOutput = input.toolOutputs.find((tool) => tool.name === "fmea.open_risks")?.output;
  const failures =
    fmeaOutput && typeof fmeaOutput === "object" && !Array.isArray(fmeaOutput)
      ? ((fmeaOutput as { failures?: Array<{ id?: unknown }> }).failures ?? [])
      : [];
  for (const failure of failures.slice(0, 12)) {
    const failureId = String(failure.id ?? "").trim();
    if (!failureId) continue;
    await linkFeatureContext(client, {
      orgId: input.orgId,
      userId: input.userId,
      sourceKind: "fmea_failure",
      sourceId: failureId,
      targetKind: "cad_job",
      targetId: input.jobId,
      relation: "blocks",
      metadata: { requestId: input.requestId },
    });
  }
  const knowledgeOutput = input.toolOutputs.find((tool) => tool.name === "knowledge.search")?.output;
  if (Array.isArray(knowledgeOutput)) {
    for (const row of knowledgeOutput.slice(0, 8) as Array<Record<string, unknown>>) {
      const pageId = String(row.id ?? row.pageId ?? "").trim();
      if (!pageId) continue;
      await linkFeatureContext(client, {
        orgId: input.orgId,
        userId: input.userId,
        sourceKind: "knowledge_page",
        sourceId: pageId,
        targetKind: "cad_job",
        targetId: input.jobId,
        relation: "documents",
        metadata: { requestId: input.requestId },
      });
    }
  }
  const scoutOutput = input.toolOutputs.find((tool) => tool.name === "scouting.team")?.output;
  if (Array.isArray(scoutOutput)) {
    for (const row of scoutOutput.slice(0, 12) as Array<Record<string, unknown>>) {
      const entryId = String(row.id ?? "").trim();
      if (!entryId) continue;
      await linkFeatureContext(client, {
        orgId: input.orgId,
        userId: input.userId,
        sourceKind: "scout_entry",
        sourceId: entryId,
        targetKind: "cad_job",
        targetId: input.jobId,
        relation: "validates",
        metadata: { requestId: input.requestId, trusted: true },
      });
    }
  }
}

/** Metered CAD brief grounded in strategy / kickoff / FMEA / knowledge / trusted scouting. */
export async function createMeteredCadBriefJob(
  client: PoolClient,
  input: CreateMeteredCadBriefInput,
): Promise<MeteredCadBriefJobResult> {
  const activeRow =
    (
      await client.query<{ active_event_key: string | null; season_year: number | null }>(
        `SELECT c.active_event_key, e.year AS season_year
         FROM org_active_context c
         LEFT JOIN events_ref e ON e.event_key = c.active_event_key
         WHERE c.org_id=$1`,
        [input.orgId],
      )
    ).rows[0] ?? null;
  const active = activeRow?.active_event_key ?? null;
  const seasonYear = resolveActiveSeasonYear({
    seasonYear: input.seasonYear ?? activeRow?.season_year,
    activeEventKey: active,
    matchKey: input.selected?.matchKey,
  });
  const registry: AIToolRegistry = createVantageToolRegistry();
  const strategyToolCalls = planCadStrategyToolCalls(input.request, {
    matchKey: input.selected?.matchKey,
    teamKey: input.selected?.teamKey,
    seasonYear,
    activeEventKey: active,
  }).filter((call) => call.name !== "cad.create_brief");

  const knowledgeNotes = await collectKnowledgeNotes(
    registry,
    client,
    input.orgId,
    input.userId,
    active,
    strategyToolCalls,
  );
  const effectiveUnits =
    input.userPreferences?.preferredUnits && input.userPreferences.preferredUnits !== "team"
      ? input.userPreferences.preferredUnits
      : input.teamProfile?.preferredUnits;
  const cadProfileNotes = [
    effectiveUnits ? `CAD dimensions must use explicit ${effectiveUnits} units` : "",
    ...(input.teamProfile?.manufacturingProcesses ?? []).slice(0, 5).map((value) => `Manufacturing process: ${value}`),
    ...(input.teamProfile?.preferredMaterials ?? []).slice(0, 5).map((value) => `Preferred material: ${value}`),
    ...(input.teamProfile?.standardComponents ?? []).slice(0, 5).map((value) => `Standard component: ${value}`),
    ...(input.teamProfile?.designRules ?? []).slice(0, 5).map((value) => `Team CAD rule: ${value}`),
  ].filter(Boolean);
  knowledgeNotes.unshift(...cadProfileNotes);

  const sources = input.sources ?? [];
  const sourceRefs = sources.map((source) => ({
    type: source.type,
    id: source.id,
    classification: source.classification,
  }));
  const requestId = input.requestId ?? `cad-brief-${randomUUID()}`;

  let parsed: EngineeringBrief;
  let toolOutputs: AnnotatedToolOutput[] = [];
  let aiRunId: string | null = null;
  let aiArtifactId: string | null = null;

  if (input.inheritMetering) {
    // Nested from chat — parent turn already went through meteredAI.
    const { annotateToolOutput, toolOutputsToContextContent } = await import("./auto-tools");
    for (const call of strategyToolCalls) {
      try {
        const output = await registry.invoke(
          call.name,
          { client, orgId: input.orgId, userId: input.userId, activeEventKey: active },
          call.input,
        );
        toolOutputs.push(annotateToolOutput(call.name, output, call.input));
      } catch (error) {
        toolOutputs.push({
          name: call.name,
          status: "setup_required",
          classification: "model_inference",
          summary: error instanceof Error ? error.message : "Tool failed",
          output: null,
          input: call.input,
        });
      }
    }
    parsed = buildEngineeringBriefFromTools({
      request: input.request,
      context: toolOutputsToContextContent(toolOutputs),
      sourceRefs,
      knowledgeNotes,
      activeSeasonYear: seasonYear,
    });
  } else {
    const orchestrated: OrchestratorResult = await new AIOrchestrator(client, registry).run({
      orgId: input.orgId,
      userId: input.userId,
      threadId: input.threadId,
      requestId,
      capability: "cad",
      privacyScope: "team",
      message: input.request,
      adapter: new BriefAdapter(sourceRefs, knowledgeNotes, seasonYear) as never,
      contextSources: sources,
      selected: input.selected,
      autoTools: true,
      toolCalls: strategyToolCalls,
      usesOrgData: true,
    });
    parsed = JSON.parse(orchestrated.text) as EngineeringBrief;
    toolOutputs = orchestrated.toolOutputs;
    aiRunId = orchestrated.runId;
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
    aiArtifactId = aiArtifact.id;
  }

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
  await writeCadBriefContextLinks(client, {
    orgId: input.orgId,
    userId: input.userId,
    jobId,
    requestId,
    title: input.title,
    selected: input.selected,
    toolOutputs,
  });

  const checksum = createHash("sha256").update(JSON.stringify(parsed)).digest("hex");
  await client.query(
    `INSERT INTO cad_artifacts(org_id,job_id,type,title,content,checksum,source_refs,created_by)
     VALUES($1,$2,'engineering_brief',$3,$4::jsonb,$5,$6::jsonb,$7)`,
    [
      input.orgId,
      jobId,
      input.title,
      JSON.stringify({ ...parsed, aiArtifactId }),
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
        aiRunId,
        aiArtifactId,
        inheritMetering: Boolean(input.inheritMetering),
        strategyTools: strategyToolCalls.map((c) => c.name),
        toolStatuses: toolOutputs.map((t) => ({ name: t.name, status: t.status })),
      }),
    ],
  );
  return {
    jobId,
    brief: parsed,
    aiRunId,
    aiArtifactId,
    tools: toolOutputs,
    status: "awaiting_brief_confirmation" as const,
  };
}
