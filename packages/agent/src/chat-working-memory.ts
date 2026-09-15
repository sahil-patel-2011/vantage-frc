/**
 * Chat-loop wiring for working memory: excerpted tool results + thread todos.
 * Goal and open todos are pinned via assembleStepContext, not compactContextItems alone.
 */

import type { ContextItem } from "./index";
import { toolOutputsToContextContent, type AnnotatedToolOutput } from "./auto-tools";
import { assembleStepContext, type WorkingTodo } from "./working-memory";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** listWorkingTodos.runId is uuid — use threadId when it is one, otherwise null. */
export function chatWorkingTodoRunId(threadId?: string | null): string | null {
  const trimmed = threadId?.trim();
  if (!trimmed) return null;
  return UUID_RE.test(trimmed) ? trimmed : null;
}

export function assembleChatCompletionContext(input: {
  message: string;
  items?: readonly ContextItem[];
  todos?: readonly WorkingTodo[] | null;
  toolOutputs?: readonly AnnotatedToolOutput[];
  tokenBudget: number;
}): ContextItem[] {
  return assembleStepContext({
    goal: input.message,
    todos: input.todos ?? null,
    items: input.items,
    toolExcerpts: toolOutputsToContextContent([...(input.toolOutputs ?? [])]),
    tokenBudget: input.tokenBudget,
  }).items;
}
