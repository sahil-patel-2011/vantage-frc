/**
 * ReAct-style autonomous agent loop for Soft-UI.
 * plan → tool call → inject tool output into next step → until final or max steps.
 * Every model step goes through meteredAI. Org session facts + tool results are injected.
 */

import type { PoolClient } from "@neondatabase/serverless";
import { isToolAllowed, loadOrgAiPolicy, meteredAI } from "@vantage/billing";
import { estimateAdapterCostUsd, type ChatAdapter, type ContextItem } from "./index";
import {
  clampAutonomousMaxSteps,
  DEFAULT_MAX_STEPS,
  failStaleRunningAutonomousRuns,
  findRunningAutonomousRunByGoal,
  finishAutonomousRun,
  getAutonomousRunWithSteps,
  readAutonomousRunStatus,
  insertAutonomousRun,
  insertAutonomousStep,
  nextAutonomousStepSequence,
  reopenAutonomousHopTransaction,
  summarizeJson,
  truncateField,
  updateAutonomousRunMaxSteps,
  MAX_ANSWER_CHARS,
  MAX_GOAL_CHARS,
  type AutonomousRunStatus,
  type AutonomousStepRow,
  type AutonomousStepStatus,
} from "./autonomous-agent-store";
import {
  buildOrgSessionContextItem,
  loadOrgSessionFacts,
} from "./org-session-context";
import { executeWebFetch, executeWebSearch } from "./web-tools";
import { annotateToolOutput } from "./auto-tools";
import type { AIToolRegistry } from "./orchestrator";
import { contextTokenBudgetForAdapter } from "./context-compact";
import { executeDesignResearch } from "./design-research";
import { extractGoalTasks, evaluateRunCompletion, shouldRefuseEarlyFinal } from "./task-finish";
import {
  assembleStepContext,
  excerptToolResult,
  type WorkingTodo,
} from "./working-memory";
import { alreadyObservedContextItem, memoryHitsForQuery } from "./working-retrieve";
import { listWorkingTodos, upsertSeedWorkingTodos } from "./working-todos";
import {
  applyWorkingTodoProgressAfterTool,
  extractFirstJsonObject,
} from "./autonomous-todo-progress";

export const AUTONOMOUS_AGENT_TOOLS = ["web.search", "web.fetch", "design.research"] as const;

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
  resumed: boolean;
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
  'You may include "todos":[{"id":"...","status":"in_progress"|"done"}] for matching open todos.',
  "Never mark a todo done unless the tool result actually completed that item.",
].join("\n");

/** Pure parser for model JSON actions — used by the loop and unit tests. */
export function parseAutonomousAgentAction(text: string): AutonomousAgentAction | null {
  const parsed = extractFirstJsonObject(text);
  if (!parsed) return null;
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
  if (name === "design.research") {
    const result = await executeDesignResearch({
      topic: String(input.topic ?? input.query ?? ""),
      mechanism: typeof input.mechanism === "string" ? input.mechanism : undefined,
      limit: input.limit != null ? Number(input.limit) : 5,
    });
    return {
      status:
        result.status === "ok"
          ? "ok"
          : result.status === "setup_required"
            ? "setup_required"
            : result.status === "empty"
              ? "empty"
              : "error",
      summary: result.message ?? `${result.results.length} grounded design source(s)`,
      excerpt: summarizeJson({ concepts: result.concepts, results: result.results }, 4000) ?? undefined,
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

export type RunAutonomousAgentInput = {
  client: PoolClient;
  orgId: string;
  userId: string;
  goal: string;
  adapter: ChatAdapter;
  requestId: string;
  maxSteps?: number;
  /** Resume this running run (same user/org) instead of starting over. */
  runId?: string;
  registry?: AIToolRegistry | null;
  promptCachingEnabled?: boolean;
  /** Extra context items (memories etc.) — never invent DEMO facts. */
  extraContext?: ContextItem[];
};

function toStepLog(row: AutonomousStepRow): AutonomousAgentStepLog {
  return {
    sequence: row.sequence,
    kind: row.kind,
    toolName: row.toolName ?? undefined,
    argsSummary: row.argsSummary ?? undefined,
    resultSummary: row.resultSummary ?? undefined,
    resultExcerpt: row.resultExcerpt ?? undefined,
    sourceUrl: row.sourceUrl ?? undefined,
    status: row.status,
  };
}

function excerptsFromPersistedTools(steps: readonly AutonomousStepRow[]): ContextItem[] {
  return steps
    .filter((step) => step.kind === "tool")
    .map((step, index) =>
      excerptToolResult(
        {
          excerpt: step.resultExcerpt,
          summary: step.resultSummary,
          status: step.status,
          tool: step.toolName,
        },
        { toolName: step.toolName ?? undefined, status: step.status, index },
      ),
    );
}

function completedPlanHops(steps: readonly { kind: string }[]): number {
  return steps.filter((step) => step.kind === "plan").length;
}

function toWorkingTodos(rows: { id: string; label: string; status: WorkingTodo["status"]; sortKey: number }[]): WorkingTodo[] {
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    status: row.status,
    sortKey: row.sortKey,
  }));
}

async function seedAutonomousWorkingTodos(
  client: PoolClient,
  input: { orgId: string; userId: string; runId: string; goal: string },
): Promise<void> {
  try {
    await upsertSeedWorkingTodos(client, {
      orgId: input.orgId,
      userId: input.userId,
      scope: "autonomous",
      runId: input.runId,
      labels: extractGoalTasks(input.goal).map((task) => task.label),
    });
  } catch {
    // Table not migrated — run continues without durable todos.
  }
}

async function resolveAutonomousRun(input: {
  client: PoolClient;
  orgId: string;
  userId: string;
  goal: string;
  requestId: string;
  maxSteps: number;
  runId?: string;
  provider: string;
  model: string;
}): Promise<{
  runId: string;
  goal: string;
  resumed: boolean;
  steps: AutonomousAgentStepLog[];
  persistedSteps: AutonomousStepRow[];
  usageEventIds: string[];
}> {
  const explicitRunId = input.runId?.trim();
  if (explicitRunId) {
    const detail = await getAutonomousRunWithSteps(input.client, input.orgId, explicitRunId);
    if (!detail || detail.run.userId !== input.userId) {
      throw new Error("Autonomous run not found");
    }
    if (detail.run.status !== "running") {
      throw new Error("Autonomous run is not running");
    }
    await updateAutonomousRunMaxSteps(input.client, {
      runId: detail.run.id,
      orgId: input.orgId,
      maxSteps: input.maxSteps,
    });
    return {
      runId: detail.run.id,
      goal: detail.run.goal,
      resumed: true,
      steps: detail.steps.map(toStepLog),
      persistedSteps: detail.steps,
      usageEventIds: [...detail.run.usageEventIds],
    };
  }

  const running = await findRunningAutonomousRunByGoal(input.client, {
    orgId: input.orgId,
    userId: input.userId,
    goal: input.goal,
  });
  if (running) {
    const detail = await getAutonomousRunWithSteps(input.client, input.orgId, running.id);
    const persisted = detail?.steps ?? [];
    await updateAutonomousRunMaxSteps(input.client, {
      runId: running.id,
      orgId: input.orgId,
      maxSteps: input.maxSteps,
    });
    return {
      runId: running.id,
      goal: running.goal,
      resumed: true,
      steps: persisted.map(toStepLog),
      persistedSteps: persisted,
      usageEventIds: [...running.usageEventIds],
    };
  }

  await failStaleRunningAutonomousRuns(input.client, {
    orgId: input.orgId,
    userId: input.userId,
    currentGoal: input.goal,
  });
  const runId = await insertAutonomousRun(input.client, {
    orgId: input.orgId,
    userId: input.userId,
    goal: input.goal,
    requestId: input.requestId,
    maxSteps: input.maxSteps,
    feature: "agent",
    provider: input.provider,
    model: input.model,
  });
  return {
    runId,
    goal: input.goal,
    resumed: false,
    steps: [],
    persistedSteps: [],
    usageEventIds: [],
  };
}

/**
 * Multi-step ReAct loop with DB persistence + meteredAI per model step.
 * Resumes a running run for the same user/org/goal (or explicit runId) from max(sequence)+1.
 */
export async function runAutonomousAgent(
  input: RunAutonomousAgentInput,
): Promise<AutonomousAgentResult> {
  const requestedGoal = truncateField(input.goal, MAX_GOAL_CHARS);
  if (!requestedGoal) throw new Error("goal is required");
  const maxSteps = clampAutonomousMaxSteps(input.maxSteps ?? DEFAULT_MAX_STEPS);
  const { client, orgId, userId, adapter } = input;

  const resolved = await resolveAutonomousRun({
    client,
    orgId,
    userId,
    goal: requestedGoal,
    requestId: input.requestId,
    maxSteps,
    runId: input.runId,
    provider: adapter.provider,
    model: adapter.model,
  });
  const runId = resolved.runId;
  const goal = resolved.goal;
  const resumed = resolved.resumed;

  const steps: AutonomousAgentStepLog[] = [...resolved.steps];
  const usageEventIds: string[] = [...resolved.usageEventIds];
  let sequence = nextAutonomousStepSequence(resolved.persistedSteps);
  let setupRequired = resolved.persistedSteps.some((step) => step.status === "setup_required");

  const sessionFacts = await loadOrgSessionFacts(client, orgId);
  const sessionItem = buildOrgSessionContextItem({
    ...sessionFacts,
    privacyScope: "team",
    capability: "agent",
  });

  await seedAutonomousWorkingTodos(client, { orgId, userId, runId, goal });
  // Run + todos must be visible to the 800ms GET poll before the first model hop.
  await reopenAutonomousHopTransaction(client, userId, orgId);

  const toolExcerpts: ContextItem[] = excerptsFromPersistedTools(resolved.persistedSteps);
  const activeRow = await client.query<{ active_event_key: string | null }>(
    `SELECT active_event_key FROM org_active_context WHERE org_id = $1::uuid`,
    [orgId],
  );
  const activeEventKey = activeRow.rows[0]?.active_event_key ?? null;

  let aiPolicy;
  try {
    aiPolicy = await loadOrgAiPolicy(client, orgId);
  } catch {
    aiPolicy = null;
  }

  try {
    const startHop = completedPlanHops(steps);
    for (let stepIndex = startHop; stepIndex < maxSteps; stepIndex++) {
      const liveStatus = await readAutonomousRunStatus(client, { orgId, runId });
      if (liveStatus === "cancelled") {
        return {
          runId,
          status: "cancelled",
          finalAnswer: null,
          steps,
          provider: adapter.provider,
          model: adapter.model,
          stepCount: steps.length,
          resumed,
          errorClass: "cancelled",
          errorMessage: "Stopped by the team",
        };
      }
      const stepRequestId = `${input.requestId}:step:${stepIndex}`;
      let todos: WorkingTodo[] = [];
      try {
        todos = toWorkingTodos(await listWorkingTodos(client, { orgId, userId, scope: "autonomous", runId }));
      } catch {
        todos = [];
      }
      const context = assembleStepContext({
        goal,
        todos,
        items: [
          ...(sessionItem ? [sessionItem] : []),
          ...(input.extraContext ?? []),
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
        ],
        toolExcerpts,
        tokenBudget: contextTokenBudgetForAdapter(adapter),
        hopIndex: stepIndex,
      }).items;

      const message = buildStepMessage(goal, stepIndex, maxSteps);
      const estimatedPrompt =
        Math.ceil(message.length / 4) +
        context.reduce((sum, item) => sum + Math.ceil(item.content.length / 4), 0);
      const estimatedCompletion = 700;

      const text = await meteredAI({
        client,
        orgId,
        userId,
        feature: "agent",
        requestId: stepRequestId,
        estimatedCostUsd: estimateAdapterCostUsd(adapter, estimatedPrompt, estimatedCompletion),
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

      await insertAutonomousStep(client, {
        orgId,
        runId,
        sequence: sequence++,
        kind: "plan",
        resultSummary: truncateField(String(text).slice(0, 500), 2000),
        status: "ok",
        requestId: stepRequestId,
        usageEventId: usageRow.rows[0]?.id ?? null,
      });
      steps.push({
        sequence: sequence - 1,
        kind: "plan",
        resultSummary: truncateField(String(text).slice(0, 500), 2000) ?? undefined,
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
        return {
          runId,
          status: "completed",
          finalAnswer: answer,
          steps,
          provider: adapter.provider,
          model: adapter.model,
          stepCount: steps.length,
          resumed,
        };
      }

      if (action.type === "final") {
        const answer = truncateField(action.answer, MAX_ANSWER_CHARS) || "Done.";
        const completion = evaluateRunCompletion({
          goal,
          answer,
          toolsUsed: steps.map((step) => step.toolName).filter((name): name is string => Boolean(name)),
          feature: "agent",
        });
        if (shouldRefuseEarlyFinal(completion, goal, "agent") && stepIndex + 1 < maxSteps) {
          toolExcerpts.push({
            type: "module_fact",
            id: `completion-gate-${stepIndex}`,
            content: JSON.stringify({
              status: "incomplete",
              missing: completion.left,
              instruction: "Continue working; use design.research before another final answer.",
            }),
            importance: 1000,
          });
          await reopenAutonomousHopTransaction(client, userId, orgId);
          continue;
        }
        await insertAutonomousStep(client, {
          orgId,
          runId,
          sequence: sequence++,
          kind: "generation",
          resultSummary: truncateField(answer.slice(0, 500), 2000),
          status: setupRequired ? "setup_required" : "ok",
        });
        steps.push({
          sequence: sequence - 1,
          kind: "generation",
          resultSummary: truncateField(answer.slice(0, 500), 2000) ?? undefined,
          status: setupRequired ? "setup_required" : "ok",
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
          runId,
          status,
          finalAnswer: answer,
          steps,
          provider: adapter.provider,
          model: adapter.model,
          stepCount: steps.length,
          resumed,
          setupRequired,
          errorClass: setupRequired ? "setup_required" : null,
        };
      }

      // tool_call
      if (aiPolicy && !isToolAllowed(aiPolicy, action.tool)) {
        throw new Error(`AI tool is not allowed by organization policy: ${action.tool}`);
      }

      if (action.tool === "web.search") {
        const query = String(action.input.query ?? "");
        const memoryHits = memoryHitsForQuery(query, toolExcerpts, todos);
        const observed = alreadyObservedContextItem(memoryHits);
        if (observed) {
          toolExcerpts.push({
            ...observed,
            id: `${observed.id}:${toolExcerpts.length}`,
          });
        }
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

      toolExcerpts.push(
        excerptToolResult(toolOut.output, {
          toolName: action.tool,
          status: toolOut.status,
          index: toolExcerpts.length,
        }),
      );
      await applyWorkingTodoProgressAfterTool(client, {
        orgId,
        userId,
        runId,
        rawModelText: String(text),
        toolName: action.tool,
        toolInput: action.input,
        toolSummary: toolOut.summary,
      });

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
      await reopenAutonomousHopTransaction(client, userId, orgId);
    }

    const answer =
      "Reached max steps without a final answer. Review the step log — partial tool results were injected but the goal may need another run.";
    await finishAutonomousRun(client, {
      runId,
      status: setupRequired ? "setup_required" : "completed",
      stepCount: steps.length,
      finalAnswer: answer,
      errorClass: setupRequired ? "setup_required" : "max_steps",
      errorMessage: setupRequired ? "One or more tools returned setup_required" : "max_steps",
      provider: adapter.provider,
      model: adapter.model,
      usageEventIds,
    });
    return {
      runId,
      status: setupRequired ? "setup_required" : "completed",
      finalAnswer: answer,
      steps,
      provider: adapter.provider,
      model: adapter.model,
      stepCount: steps.length,
      resumed,
      setupRequired,
      errorClass: setupRequired ? "setup_required" : "max_steps",
    };
  } catch (error) {
    const cancelled = (await readAutonomousRunStatus(client, { orgId, runId })) === "cancelled";
    if (cancelled) {
      return {
        runId,
        status: "cancelled",
        finalAnswer: null,
        steps,
        provider: adapter.provider,
        model: adapter.model,
        stepCount: steps.length,
        resumed,
        errorClass: "cancelled",
        errorMessage: "Stopped by the team",
      };
    }
    const message = error instanceof Error ? error.message : "Autonomous agent failed";
    const isSetup =
      /setup_required|No AI provider|No configured model|provider key/i.test(message) || setupRequired;
    const status: AutonomousRunStatus = isSetup ? "setup_required" : "failed";
    await finishAutonomousRun(client, {
      runId,
      status,
      stepCount: steps.length,
      errorClass: isSetup ? "setup_required" : "error",
      errorMessage: message,
      provider: adapter.provider,
      model: adapter.model,
      usageEventIds,
    }).catch(() => undefined);
    await insertAutonomousStep(client, {
      orgId,
      runId,
      sequence: sequence,
      kind: "error",
      resultSummary: message.slice(0, 500),
      status: "error",
    }).catch(() => undefined);
    return {
      runId,
      status,
      finalAnswer: null,
      steps,
      provider: adapter.provider,
      model: adapter.model,
      stepCount: steps.length,
      resumed,
      errorClass: isSetup ? "setup_required" : "error",
      errorMessage: message,
      setupRequired: isSetup,
    };
  }
}
