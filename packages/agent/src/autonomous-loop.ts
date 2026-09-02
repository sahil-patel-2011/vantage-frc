/**
 * ReAct-style autonomous agent loop for Soft-UI.
 * plan → tool call → inject tool output into next step → until final or max steps.
 * Every model step goes through meteredAI with a real cost estimate. Org session facts +
 * tool results are injected.
 *
 * Execution model (0498): the route creates the run row, answers {runId} immediately and
 * runs this loop after the response. Each step executes in its own transaction
 * (`transact`, normally withRls) so the persisted step rows are visible to the polling
 * GET as they land, and a cooperative cancel flag is checked between steps.
 */

import type { PoolClient } from "@neondatabase/serverless";
import { isToolAllowed, loadOrgAiPolicy, meteredAI } from "@vantage/billing";
import type { ChatAdapter, ContextItem } from "./index";
import {
  DEFAULT_MAX_STEPS,
  finishAutonomousRun,
  insertAutonomousRun,
  insertAutonomousStep,
  isAutonomousRunCancelRequested,
  summarizeJson,
  truncateField,
  MAX_ANSWER_CHARS,
  MAX_GOAL_CHARS,
  type AutonomousRunStatus,
  type AutonomousStepStatus,
} from "./autonomous-agent-store";
import {
  buildOrgSessionContextItem,
  loadOrgSessionFacts,
  type OrgSessionFacts,
} from "./org-session-context";
import { executeWebFetch, executeWebSearch } from "./web-tools";
import { annotateToolOutput, toolOutputsToContextContent } from "./auto-tools";
import type { AIToolRegistry } from "./orchestrator";
import { routeAdapterForRequest } from "./model-routing";
import type { ResolvedModelSource } from "./resolve-chat-adapter";

export const AUTONOMOUS_AGENT_TOOLS = ["web.search", "web.fetch"] as const;

export type AutonomousAgentAction =
  | { type: "tool_call"; tool: string; input: Record<string, unknown> }
  | { type: "final"; answer: string };

export type AutonomousAgentStepLog = {
  sequence: number;
  kind: "plan" | "tool" | "observe" | "generation" | "error";
  toolName?: string;
  argsSummary?: string;
  resultSummary?: string;
  resultExcerpt?: string;
  sourceUrl?: string;
  status: AutonomousStepStatus;
};

export type AutonomousAgentResult = {
  runId: string;
  status: AutonomousRunStatus;
  finalAnswer: string | null;
  steps: AutonomousAgentStepLog[];
  provider: string;
  model: string;
  stepCount: number;
  errorClass?: string | null;
  errorMessage?: string | null;
  setupRequired?: boolean;
};

const REACT_INSTRUCTION = [
  "You are Vantage's autonomous Soft-UI agent. Work toward the user's goal using tools when needed.",
  "Respond with ONLY a single JSON object (no markdown fences):",
  '{"type":"tool_call","tool":"web.search"|"web.fetch"|other_registry_tool,"input":{...}}',
  'or {"type":"final","answer":"..."}',
  "Use injected org session facts and prior tool results. Never invent DEMO metrics or pretend a tool succeeded.",
  "If a tool returned setup_required, say so honestly in the final answer and stop.",
  "Prefer web.search then web.fetch on allowlisted FRC docs when the goal needs public documentation.",
].join("\n");

/** Pure parser for model JSON actions — used by the loop and unit tests. */
export function parseAutonomousAgentAction(text: string): AutonomousAgentAction | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence?.[1]?.trim() ?? trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
    if (parsed.type === "final" && typeof parsed.answer === "string") {
      return { type: "final", answer: parsed.answer.trim() };
    }
    if (parsed.type === "tool_call" && typeof parsed.tool === "string") {
      const input =
        parsed.input && typeof parsed.input === "object" && !Array.isArray(parsed.input)
          ? (parsed.input as Record<string, unknown>)
          : {};
      return { type: "tool_call", tool: parsed.tool.trim(), input };
    }
    // Soft aliases some models emit
    if (typeof parsed.tool === "string" && parsed.answer == null) {
      const input =
        parsed.input && typeof parsed.input === "object" && !Array.isArray(parsed.input)
          ? (parsed.input as Record<string, unknown>)
          : {};
      return { type: "tool_call", tool: String(parsed.tool).trim(), input };
    }
    if (typeof parsed.answer === "string") {
      return { type: "final", answer: parsed.answer.trim() };
    }
  } catch {
    return null;
  }
  return null;
}

function buildStepMessage(goal: string, stepIndex: number, maxSteps: number): string {
  return [
    REACT_INSTRUCTION,
    "",
    `Goal: ${goal}`,
    `Step ${stepIndex + 1} of ${maxSteps}. Choose the next tool_call or final.`,
  ].join("\n");
}

async function invokeNamedTool(
  name: string,
  input: Record<string, unknown>,
  registry: AIToolRegistry | null,
  toolContext: { client: PoolClient; orgId: string; userId: string; activeEventKey: string | null },
): Promise<{ status: AutonomousStepStatus; summary: string; excerpt?: string; sourceUrl?: string; output: unknown }> {
  if (name === "web.search") {
    const result = await executeWebSearch({
      query: String(input.query ?? ""),
      limit: input.limit != null ? Number(input.limit) : 5,
    });
    const status: AutonomousStepStatus =
      result.status === "ok"
        ? "ok"
        : result.status === "empty"
          ? "empty"
          : result.status === "setup_required"
            ? "setup_required"
            : "error";
    return {
      status,
      summary: result.message ?? `${result.results.length} search hit(s)`,
      excerpt: summarizeJson(result.results.slice(0, 5), 4000) ?? undefined,
      output: result,
    };
  }
  if (name === "web.fetch") {
    const result = await executeWebFetch({ url: String(input.url ?? "") });
    const status: AutonomousStepStatus =
      result.status === "ok" ? "ok" : result.status === "setup_required" ? "setup_required" : "error";
    return {
      status,
      summary: result.message ?? (result.truncated ? "Fetched (truncated excerpt)" : "Fetched excerpt"),
      excerpt: result.excerpt,
      sourceUrl: result.finalUrl ?? result.url,
      output: result,
    };
  }
  if (!registry) {
    return {
      status: "error",
      summary: `Unknown tool: ${name}`,
      output: { error: `Unknown tool: ${name}` },
    };
  }
  try {
    const output = await registry.invoke(name, toolContext, input);
    const annotated = annotateToolOutput(name, output, input);
    return {
      status: annotated.status,
      summary: annotated.summary,
      excerpt: summarizeJson(output, 4000) ?? undefined,
      output,
    };
  } catch (error) {
    return {
      status: "error",
      summary: error instanceof Error ? error.message : "Tool failed",
      output: { error: error instanceof Error ? error.message : "Tool failed" },
    };
  }
}

/** Runs one unit of work in its own transaction (see RunAutonomousAgentInput.transact). */
export type AutonomousTransact = <T>(work: (client: PoolClient) => Promise<T>) => Promise<T>;

export type RunAutonomousAgentInput = {
  client: PoolClient;
  orgId: string;
  userId: string;
  goal: string;
  adapter: ChatAdapter;
  requestId: string;
  maxSteps?: number;
  registry?: AIToolRegistry | null;
  promptCachingEnabled?: boolean;
  /** Extra context items (memories etc.) — never invent DEMO facts. */
  extraContext?: ContextItem[];
  /**
   * An existing autonomous_agent_runs row (the route inserts it before answering
   * {runId}); the loop then executes against it instead of inserting its own.
   */
  runId?: string;
  /**
   * Per-step transaction runner. When set, every step (model call, tool, persisted step
   * rows, cancel check) runs in its own committed transaction so a polling reader sees
   * progress as it lands. Defaults to running everything on `client`.
   */
  transact?: AutonomousTransact;
  /** Provenance source of `adapter`; hosted adapters are plan-gated through routeModel. */
  modelSource?: ResolvedModelSource;
};

type StepOutcome = { done: AutonomousAgentResult } | { done?: undefined };

/**
 * Multi-step ReAct loop with DB persistence + meteredAI per model step.
 */
export async function runAutonomousAgent(
  input: RunAutonomousAgentInput,
): Promise<AutonomousAgentResult> {
  const goal = truncateField(input.goal, MAX_GOAL_CHARS);
  if (!goal) throw new Error("goal is required");
  const maxSteps = Math.min(Math.max(input.maxSteps ?? DEFAULT_MAX_STEPS, 1), 20);
  const { orgId, userId, adapter } = input;
  const tx: AutonomousTransact = input.transact ?? ((work) => work(input.client));

  const runId =
    input.runId ??
    (await tx((client) =>
      insertAutonomousRun(client, {
        orgId,
        userId,
        goal,
        requestId: input.requestId,
        maxSteps,
        feature: "agent",
        provider: adapter.provider,
        model: adapter.model,
      }),
    ));

  const steps: AutonomousAgentStepLog[] = [];
  const usageEventIds: string[] = [];
  let sequence = 0;
  let setupRequired = false;

  const finish = (
    status: AutonomousRunStatus,
    extra: Partial<AutonomousAgentResult> & { finalAnswer: string | null },
  ): AutonomousAgentResult => ({
    runId,
    status,
    steps,
    provider: adapter.provider,
    model: adapter.model,
    stepCount: steps.length,
    ...extra,
  });

  const prelude = await tx(async (client) => {
    const sessionFacts: OrgSessionFacts = await loadOrgSessionFacts(client, orgId);
    const activeRow = await client.query<{ active_event_key: string | null }>(
      `SELECT active_event_key FROM org_active_context WHERE org_id = $1::uuid`,
      [orgId],
    );
    let aiPolicy: Awaited<ReturnType<typeof loadOrgAiPolicy>> | null;
    try {
      aiPolicy = await loadOrgAiPolicy(client, orgId);
    } catch {
      aiPolicy = null;
    }
    return {
      sessionItem: buildOrgSessionContextItem({
        ...sessionFacts,
        privacyScope: "team",
        capability: "agent",
      }),
      activeEventKey: activeRow.rows[0]?.active_event_key ?? null,
      aiPolicy,
    };
  });
  const { sessionItem, activeEventKey, aiPolicy } = prelude;
  const toolResultItems: ContextItem[] = [];

  try {
    for (let stepIndex = 0; stepIndex < maxSteps; stepIndex++) {
      // Cooperative cancel between steps — the run owner set the flag through the route.
      const cancelled = await tx((client) => isAutonomousRunCancelRequested(client, { orgId, runId }));
      if (cancelled) {
        await tx((client) =>
          finishAutonomousRun(client, {
            runId,
            status: "cancelled",
            stepCount: steps.length,
            errorClass: "cancelled",
            errorMessage: "Cancelled by the run owner",
            provider: adapter.provider,
            model: adapter.model,
            usageEventIds,
          }),
        );
        return finish("cancelled", { finalAnswer: null, errorClass: "cancelled" });
      }

      const stepRequestId = `${input.requestId}:step:${stepIndex}`;
      const context: ContextItem[] = [
        ...(sessionItem ? [sessionItem] : []),
        ...(input.extraContext ?? []),
        ...toolResultItems,
        {
          type: "module_fact",
          id: "available-tools",
          content: JSON.stringify({
            tools: [
              ...AUTONOMOUS_AGENT_TOOLS.map((name) => ({ name })),
              ...(input.registry?.list() ?? []).slice(0, 30),
            ],
          }),
          importance: 400,
        },
      ];

      const message = buildStepMessage(goal, stepIndex, maxSteps);
      const estimatedPrompt =
        Math.ceil(message.length / 4) +
        context.reduce((sum, item) => sum + Math.ceil(item.content.length / 4), 0);
      const estimatedCompletion = 700;

      const outcome: StepOutcome = await tx(async (client) => {
        const routed = await routeAdapterForRequest(client, {
          orgId,
          adapter,
          capability: "agent",
          modelSource: input.modelSource,
          estimatedInputTokens: estimatedPrompt,
          estimatedOutputTokens: estimatedCompletion,
        });
        const text = await meteredAI({
          client,
          orgId,
          userId,
          feature: "agent",
          requestId: stepRequestId,
          estimatedCostUsd: routed.estimatedCostUsd,
          estimatedPromptTokens: estimatedPrompt,
          estimatedCompletionTokens: estimatedCompletion,
          provider: adapter.provider,
          model: adapter.model,
          billingOwner: { type: "org", id: orgId },
          metadata: {
            runId,
            autonomous: true,
            stepIndex,
            usageTag: "agent.autonomous",
            promptCachingEnabled: input.promptCachingEnabled ?? true,
            paygOnly: routed.paygOnly,
            billingBucket: routed.billingBucket,
            ...(input.modelSource ? { modelSource: input.modelSource } : {}),
          },
          invoke: async () => {
            const result = await adapter.complete({
              message,
              context,
              promptCachingEnabled: input.promptCachingEnabled,
            });
            return {
              value: result.text,
              ...result,
              provider: adapter.provider,
              model: adapter.model,
            };
          },
        });

        const usageRow = await client.query<{ id: string }>(
          `SELECT id FROM ai_usage_events WHERE request_id = $1`,
          [stepRequestId],
        );
        if (usageRow.rows[0]?.id) usageEventIds.push(usageRow.rows[0].id);

        const planSummary = truncateField(String(text).slice(0, 500), 2000);
        await insertAutonomousStep(client, {
          orgId,
          runId,
          sequence: sequence++,
          kind: "plan",
          resultSummary: planSummary,
          status: "ok",
          requestId: stepRequestId,
          usageEventId: usageRow.rows[0]?.id ?? null,
        });
        steps.push({
          sequence: sequence - 1,
          kind: "plan",
          resultSummary: planSummary ?? undefined,
          status: "ok",
        });

        const action = parseAutonomousAgentAction(String(text));
        if (!action) {
          const answer =
            truncateField(String(text), MAX_ANSWER_CHARS) ??
            "The model did not return a structured action. Stopping.";
          await finishAutonomousRun(client, {
            runId,
            status: "completed",
            stepCount: steps.length,
            finalAnswer: answer,
            provider: adapter.provider,
            model: adapter.model,
            usageEventIds,
          });
          return { done: finish("completed", { finalAnswer: answer }) };
        }

        if (action.type === "final") {
          const answer = truncateField(action.answer, MAX_ANSWER_CHARS) || "Done.";
          const stepStatus: AutonomousStepStatus = setupRequired ? "setup_required" : "ok";
          await insertAutonomousStep(client, {
            orgId,
            runId,
            sequence: sequence++,
            kind: "generation",
            resultSummary: truncateField(answer.slice(0, 500), 2000),
            status: stepStatus,
          });
          steps.push({
            sequence: sequence - 1,
            kind: "generation",
            resultSummary: truncateField(answer.slice(0, 500), 2000) ?? undefined,
            status: stepStatus,
          });
          const status: AutonomousRunStatus = setupRequired ? "setup_required" : "completed";
          await finishAutonomousRun(client, {
            runId,
            status,
            stepCount: steps.length,
            finalAnswer: answer,
            errorClass: setupRequired ? "setup_required" : null,
            provider: adapter.provider,
            model: adapter.model,
            usageEventIds,
          });
          return {
            done: finish(status, {
              finalAnswer: answer,
              setupRequired,
              errorClass: setupRequired ? "setup_required" : null,
            }),
          };
        }

        // tool_call
        if (aiPolicy && !isToolAllowed(aiPolicy, action.tool)) {
          throw new Error(`AI tool is not allowed by organization policy: ${action.tool}`);
        }

        const toolOut = await invokeNamedTool(action.tool, action.input, input.registry ?? null, {
          client,
          orgId,
          userId,
          activeEventKey,
        });
        if (toolOut.status === "setup_required") setupRequired = true;

        const argsSummary = summarizeJson(action.input) ?? undefined;
        await insertAutonomousStep(client, {
          orgId,
          runId,
          sequence: sequence++,
          kind: "tool",
          toolName: action.tool,
          argsSummary,
          resultSummary: toolOut.summary,
          resultExcerpt: toolOut.excerpt,
          sourceUrl: toolOut.sourceUrl,
          status: toolOut.status,
        });
        steps.push({
          sequence: sequence - 1,
          kind: "tool",
          toolName: action.tool,
          argsSummary,
          resultSummary: toolOut.summary,
          resultExcerpt: toolOut.excerpt,
          sourceUrl: toolOut.sourceUrl,
          status: toolOut.status,
        });

        const annotated = annotateToolOutput(action.tool, toolOut.output, action.input);
        const injected = toolOutputsToContextContent([
          {
            ...annotated,
            summary: toolOut.summary,
            status: toolOut.status === "error" ? "empty" : toolOut.status,
          },
        ]);
        toolResultItems.push(
          ...injected.map((item, i) => ({
            ...item,
            id: `${item.id}:s${stepIndex}:${i}`,
            importance: 900,
          })),
        );

        await insertAutonomousStep(client, {
          orgId,
          runId,
          sequence: sequence++,
          kind: "observe",
          toolName: action.tool,
          resultSummary: `Injected ${action.tool} result into next step context`,
          status: toolOut.status,
        });
        steps.push({
          sequence: sequence - 1,
          kind: "observe",
          toolName: action.tool,
          resultSummary: `Injected ${action.tool} result into next step context`,
          status: toolOut.status,
        });
        // Keep the run row's step_count current so the poller shows progress.
        await client.query(
          `UPDATE autonomous_agent_runs SET step_count = $2 WHERE id = $1::uuid`,
          [runId, steps.length],
        );
        return {};
      });
      if (outcome.done) return outcome.done;
    }

    const answer =
      "Reached max steps without a final answer. Review the step log — partial tool results were injected but the goal may need another run.";
    const status: AutonomousRunStatus = setupRequired ? "setup_required" : "completed";
    await tx((client) =>
      finishAutonomousRun(client, {
        runId,
        status,
        stepCount: steps.length,
        finalAnswer: answer,
        errorClass: setupRequired ? "setup_required" : "max_steps",
        errorMessage: setupRequired ? "One or more tools returned setup_required" : "max_steps",
        provider: adapter.provider,
        model: adapter.model,
        usageEventIds,
      }),
    );
    return finish(status, {
      finalAnswer: answer,
      setupRequired,
      errorClass: setupRequired ? "setup_required" : "max_steps",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Autonomous agent failed";
    const isSetup =
      /setup_required|No AI provider|No configured model|provider key/i.test(message) || setupRequired;
    const status: AutonomousRunStatus = isSetup ? "setup_required" : "failed";
    await tx((client) =>
      finishAutonomousRun(client, {
        runId,
        status,
        stepCount: steps.length,
        errorClass: isSetup ? "setup_required" : "error",
        errorMessage: message,
        provider: adapter.provider,
        model: adapter.model,
        usageEventIds,
      }),
    ).catch(() => undefined);
    await tx((client) =>
      insertAutonomousStep(client, {
        orgId,
        runId,
        sequence: sequence,
        kind: "error",
        resultSummary: message.slice(0, 500),
        status: "error",
      }),
    ).catch(() => undefined);
    return finish(status, {
      finalAnswer: null,
      errorClass: isSetup ? "setup_required" : "error",
      errorMessage: message,
      setupRequired: isSetup,
    });
  }
}
