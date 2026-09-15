/**
 * CAD working-memory checkpoints: pin brief/plan, excerpt tool hops, and
 * isolate multitask children so the parent only sees {taskId, summary, ok}.
 * Pure helpers — persist goes through saveCadAgentSession in the loop.
 */

import type { PoolClient } from "@neondatabase/serverless";
import {
  assembleStepContext,
  CLOUD_CONTEXT_TOKEN_BUDGET,
  excerptToolResult,
  type ContextItem,
  type WorkingTodo,
  type WorkingTodoStatus,
} from "@vantage/agent";
import { summarizeCadAgentSteps, type CadAgentStep, type CadTaskStatus } from "@vantage/cad";
import type { CadStoredPlan } from "./agent-mode-session";
import type { CadAgentChatMessage } from "./cad-agent-session";

export const CAD_WORKING_SCOPE = "cad" as const;
export const CAD_PARENT_HANDOFF_ID_PREFIX = "cad-parent-handoff:";
export const CAD_PARENT_HANDOFF_IMPORTANCE = 650;
export const CAD_HOP_CHECKPOINT_ASSISTANT = "Working in Onshape…";

export type CadParentHandoff = {
  taskId: string;
  summary: string;
  ok: boolean;
};

export type CadPlanLike = Pick<CadStoredPlan, "brief" | "steps" | "approved">;

/** User brief + approved plan, pinned the same way as an autonomous goal. */
export function pinCadBriefAndPlan(brief: string, plan?: CadPlanLike | null): string {
  const userBrief = (plan?.brief || brief).trim();
  const lines: string[] = [];
  if (userBrief) lines.push(userBrief);
  if (plan?.approved && plan.steps.length) {
    lines.push("Approved plan:");
    for (const step of plan.steps) {
      const title = step.title.trim();
      if (!title) continue;
      lines.push(`${step.index}. ${title}${step.detail ? ` — ${step.detail}` : ""}`);
    }
  }
  return lines.join("\n");
}

export function cadWorkingTodoLabels(input: {
  plan?: { steps: ReadonlyArray<{ title: string }> } | null;
  tasks?: ReadonlyArray<{ title: string }> | null;
}): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const label = raw.trim();
    if (!label || seen.has(label)) return;
    seen.add(label);
    labels.push(label);
  };
  for (const step of input.plan?.steps ?? []) push(step.title);
  for (const task of input.tasks ?? []) push(task.title);
  return labels;
}

export function workingStatusFromCadTask(status: CadTaskStatus): WorkingTodoStatus {
  switch (status) {
    case "pending":
      return "pending";
    case "in_progress":
      return "in_progress";
    case "done":
      return "done";
    case "failed":
      return "blocked";
    default: {
      const _never: never = status;
      return _never;
    }
  }
}

export function excerptCadToolResult(input: {
  tool: string;
  result: unknown;
  ok: boolean;
  index: number;
}): ContextItem {
  return excerptToolResult(input.result, {
    toolName: input.tool,
    status: input.ok ? "ok" : "error",
    index: input.index,
  });
}

/** Parent-only child handoff. Never include the child's tool dumps. */
export function parentTaskHandoff(input: CadParentHandoff): ContextItem {
  const payload: CadParentHandoff = {
    taskId: input.taskId,
    summary: input.summary.trim().slice(0, 400),
    ok: input.ok,
  };
  return {
    type: "module_fact",
    id: `${CAD_PARENT_HANDOFF_ID_PREFIX}${payload.taskId}`,
    importance: CAD_PARENT_HANDOFF_IMPORTANCE,
    content: JSON.stringify(payload),
  };
}

export function isParentTaskHandoff(item: Pick<ContextItem, "id">): boolean {
  return item.id.startsWith(CAD_PARENT_HANDOFF_ID_PREFIX);
}

export function parseParentTaskHandoff(item: ContextItem): CadParentHandoff | null {
  if (!isParentTaskHandoff(item)) return null;
  try {
    const parsed = JSON.parse(item.content) as Partial<CadParentHandoff>;
    if (typeof parsed.taskId !== "string" || typeof parsed.summary !== "string" || typeof parsed.ok !== "boolean") {
      return null;
    }
    return { taskId: parsed.taskId, summary: parsed.summary, ok: parsed.ok };
  } catch {
    return null;
  }
}

/** Fresh excerpt buffer per sub-task. Do not share with the parent or siblings. */
export function createChildToolExcerpts(): ContextItem[] {
  return [];
}

export function assembleCadHopContext(input: {
  brief: string;
  plan?: CadPlanLike | null;
  todos?: readonly WorkingTodo[] | null;
  items?: readonly ContextItem[];
  toolExcerpts?: readonly ContextItem[];
  tokenBudget?: number;
}): ContextItem[] {
  return assembleStepContext({
    goal: pinCadBriefAndPlan(input.brief, input.plan),
    todos: input.todos ?? null,
    items: input.items ?? [],
    toolExcerpts: input.toolExcerpts ?? [],
    tokenBudget: input.tokenBudget ?? CLOUD_CONTEXT_TOKEN_BUDGET,
  }).items;
}

/**
 * Mid-turn transcript so a 300s cutoff still has the build log.
 * finishTurn overwrites this with the final assistant reply.
 */
export function checkpointCadSessionMessages(input: {
  history: readonly CadAgentChatMessage[];
  userText: string;
  steps: readonly CadAgentStep[];
  reply?: string;
}): CadAgentChatMessage[] {
  const userText = input.userText.trim();
  const stepSummary = summarizeCadAgentSteps(input.steps);
  const assistantText = input.reply
    ? stepSummary
      ? `${input.reply}\n\n${stepSummary}`
      : input.reply
    : stepSummary || CAD_HOP_CHECKPOINT_ASSISTANT;
  return [
    ...input.history,
    ...(userText ? [{ role: "user" as const, text: userText }] : []),
    { role: "assistant" as const, text: assistantText },
  ].slice(-24);
}

/**
 * Commit the hop so a later function kill / withRls ROLLBACK cannot wipe it,
 * then open a fresh RLS transaction for the rest of the turn.
 */
export async function reopenCadHopTransaction(
  client: PoolClient,
  userId: string,
  orgId: string,
): Promise<void> {
  await client.query("COMMIT");
  await client.query("BEGIN");
  await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
  await client.query("SELECT set_config('app.org_id', $1, true)", [orgId]);
}
