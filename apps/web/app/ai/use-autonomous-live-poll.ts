"use client";

import { useCallback, useRef } from "react";
import {
  AUTONOMOUS_LIVE_POLL_MS,
  autonomousRunHref,
  autonomousTodosHref,
  nextAutonomousPollDelayMs,
  nextAutonomousPollTick,
  type LiveAutonomousRun,
} from "../../lib/agent/autonomous-live-poll";
import type { AutonomousTodoItem } from "./autonomous-todo-list";

export type LiveRunTick = {
  run: LiveAutonomousRun;
  steps: unknown[];
  todos: AutonomousTodoItem[];
  todosSetupRequired: boolean;
};

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function asRun(value: unknown): LiveAutonomousRun | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<LiveAutonomousRun>;
  if (typeof row.id !== "string" || typeof row.goal !== "string" || typeof row.status !== "string") {
    return null;
  }
  return {
    id: row.id,
    goal: row.goal,
    status: row.status,
    finishedAt: typeof row.finishedAt === "string" ? row.finishedAt : null,
    provider: typeof row.provider === "string" ? row.provider : null,
    model: typeof row.model === "string" ? row.model : null,
    stepCount: typeof row.stepCount === "number" ? row.stepCount : undefined,
    finalAnswer: typeof row.finalAnswer === "string" ? row.finalAnswer : null,
    errorClass: typeof row.errorClass === "string" ? row.errorClass : null,
    errorMessage: typeof row.errorMessage === "string" ? row.errorMessage : null,
  };
}

function asRuns(value: unknown): LiveAutonomousRun[] {
  if (!Array.isArray(value)) return [];
  return value.map(asRun).filter((row): row is LiveAutonomousRun => row !== null);
}

function asTodos(value: unknown): AutonomousTodoItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const item = row as Partial<AutonomousTodoItem>;
    if (typeof item.id !== "string" || typeof item.label !== "string") return [];
    return [{ id: item.id, label: item.label, status: typeof item.status === "string" ? item.status : "pending" }];
  });
}

async function loadTodos(
  orgId: string,
  runId: string,
  signal: AbortSignal,
): Promise<{ todos: AutonomousTodoItem[]; setupRequired: boolean }> {
  try {
    const response = await fetch(autonomousTodosHref(orgId, runId), { signal });
    const data = await readJson(response);
    const setupRequired =
      data.setup_required === true || data.code === "setup_required" || response.status === 503;
    if (!response.ok) return { todos: [], setupRequired };
    return { todos: asTodos(data.todos), setupRequired };
  } catch {
    return { todos: [], setupRequired: false };
  }
}

export function useAutonomousLivePoll() {
  const abortRef = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const start = useCallback(
    async (input: {
      orgId: string;
      goal: string;
      runId?: string | null;
      onTick: (tick: LiveRunTick) => void;
    }): Promise<{ runId: string | null; done: boolean }> => {
      stop();
      const abort = new AbortController();
      abortRef.current = abort;
      let runId = input.runId?.trim() || null;

      const tickOnce = async (): Promise<{ done: boolean; failed: boolean }> => {
        if (runId) {
          const response = await fetch(autonomousRunHref(input.orgId, runId), { signal: abort.signal });
          if (!response.ok) return { done: false, failed: true };
          const data = await readJson(response);
          const action = nextAutonomousPollTick({
            runId,
            goal: input.goal,
            detail: {
              run: asRun(data.run),
              steps: Array.isArray(data.steps) ? data.steps : [],
              setup_required: data.setup_required === true,
            },
          });
          if (action.kind === "update") {
            const listed = await loadTodos(input.orgId, action.run.id, abort.signal);
            input.onTick({
              run: action.run,
              steps: action.steps,
              todos: listed.todos,
              todosSetupRequired: listed.setupRequired,
            });
            return { done: action.done, failed: false };
          }
          return { done: false, failed: false };
        }
        const response = await fetch(
          `/api/agent/autonomous?orgId=${encodeURIComponent(input.orgId)}`,
          { signal: abort.signal },
        );
        if (!response.ok) return { done: false, failed: true };
        const data = await readJson(response);
        const action = nextAutonomousPollTick({
          runId: null,
          goal: input.goal,
          listRuns: asRuns(data.runs),
        });
        if (action.kind === "discover") {
          runId = action.runId;
          const listed = await loadTodos(input.orgId, action.runId, abort.signal);
          input.onTick({
            run: action.run,
            steps: [],
            todos: listed.todos,
            todosSetupRequired: listed.setupRequired,
          });
        }
        return { done: false, failed: false };
      };

      const wait = (delayMs: number) =>
        new Promise<void>((resolve, reject) => {
          if (abort.signal.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
          }
          const id = window.setTimeout(resolve, delayMs);
          abort.signal.addEventListener(
            "abort",
            () => {
              window.clearTimeout(id);
              reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
          );
        });

      let failures = 0;
      try {
        while (!abort.signal.aborted) {
          try {
            const tick = await tickOnce();
            if (tick.failed) failures += 1;
            else failures = 0;
            if (tick.done) return { runId, done: true };
          } catch (error) {
            if (abort.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
              return { runId, done: false };
            }
            failures += 1;
          }
          await wait(nextAutonomousPollDelayMs(failures) || AUTONOMOUS_LIVE_POLL_MS);
        }
      } catch (error) {
        if (abort.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
          return { runId, done: false };
        }
        throw error;
      }
      return { runId, done: false };
    },
    [stop],
  );

  return { start, stop };
}
