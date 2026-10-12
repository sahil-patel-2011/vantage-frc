"use client";

import { useCallback, useEffect, useState } from "react";
import { ModelProvenance } from "../../components/ui";
import { resolveCutoffErrorCode } from "../../components/usage-cutoff-banner";
import { agentRunStoppedUnexpectedly } from "../../lib/ai/agent-run-status";

/**
 * "Work on this in the background" — the former Agent tab, folded into Ask AI as a mode.
 * Same route (`/api/agent/autonomous`), same stored runs; it plans, looks things up step by
 * step, and answers. Only sites the team allows are opened.
 */

export type BackgroundRun = {
  id: string;
  goal: string;
  status: string;
  provider: string | null;
  model: string | null;
  stepCount: number;
  finalAnswer: string | null;
  errorClass: string | null;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
};

type Step = {
  sequence: number;
  kind: string;
  toolName?: string | null;
  resultSummary?: string | null;
  sourceUrl?: string | null;
  status: string;
};

export function backgroundRunLabel(run: Pick<BackgroundRun, "status" | "startedAt" | "finishedAt">): string {
  if (agentRunStoppedUnexpectedly(run)) return "Stopped unexpectedly";
  switch (run.status) {
    case "running":
      return "Working";
    case "completed":
      return "Finished";
    case "failed":
      return "Stopped with an error";
    case "setup_required":
      return "Needs setup";
    case "cancelled":
      return "Stopped";
    default:
      return run.status.replaceAll("_", " ");
  }
}

export type BackgroundFailure = { message: string; setup: boolean; cutoff: string | null };

/** Past runs plus "start one" for the composer. */
export function useBackgroundWork(orgId: string) {
  const [runs, setRuns] = useState<BackgroundRun[]>([]);
  const [selected, setSelected] = useState<{ run: BackgroundRun; steps: Step[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/agent/autonomous?orgId=${encodeURIComponent(orgId)}`).catch(() => null);
    if (!response?.ok) return;
    const data = (await response.json().catch(() => null)) as { runs?: BackgroundRun[] } | null;
    setRuns(data?.runs ?? []);
  }, [orgId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const open = useCallback(
    async (runId: string) => {
      const response = await fetch(
        `/api/agent/autonomous?orgId=${encodeURIComponent(orgId)}&runId=${encodeURIComponent(runId)}`,
      ).catch(() => null);
      if (!response?.ok) return;
      const data = (await response.json()) as { run?: BackgroundRun | null; steps?: Step[] };
      if (data.run) setSelected({ run: data.run, steps: data.steps ?? [] });
    },
    [orgId],
  );

  /** Runs a goal; resolves with a failure in plain words, or null when it ran. */
  const start = useCallback(
    async (goal: string): Promise<BackgroundFailure | null> => {
      setBusy(true);
      try {
        const response = await fetch("/api/agent/autonomous", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, goal, maxSteps: 8 }),
        });
        const data = (await response.json().catch(() => ({}))) as {
          runId?: string;
          run?: BackgroundRun | null;
          persistedSteps?: Step[];
          error?: string;
          message?: string;
          code?: string;
        };
        if (!response.ok) {
          return {
            message: data.message ?? data.error ?? "Background work couldn't start.",
            setup: data.code === "setup_required" || response.status === 503,
            cutoff: resolveCutoffErrorCode(response.status, data) ?? null,
          };
        }
        if (data.run) setSelected({ run: data.run, steps: data.persistedSteps ?? [] });
        await refresh();
        return null;
      } catch {
        return { message: "Background work couldn't start. Check your connection and try again.", setup: false, cutoff: null };
      } finally {
        setBusy(false);
      }
    },
    [orgId, refresh],
  );

  return { runs, selected, busy, refresh, open, start, close: () => setSelected(null) };
}

/** One background run in the conversation area: status, answer, and the steps behind it. */
export function BackgroundRunCard({ run, steps, onClose }: { run: BackgroundRun; steps: Step[]; onClose: () => void }) {
  return (
    <article className="ask-bg-card" aria-label="Background work">
      <header>
        <span className="eyebrow">Background work · {backgroundRunLabel(run)}</span>
        <button type="button" className="ask-bg-close" onClick={onClose} aria-label="Close background work">
          Close
        </button>
      </header>
      <h3>{run.goal}</h3>
      <ModelProvenance meta={{ provider: run.provider, modelId: run.model }} />
      {run.errorMessage ? <p className="ask-bg-error">{run.errorMessage}</p> : null}
      {run.finalAnswer ? <p className="ch-msg-body">{run.finalAnswer}</p> : null}
      {steps.length ? (
        <details>
          <summary data-disclosure>
            {steps.length} step{steps.length === 1 ? "" : "s"}
          </summary>
          <ol className="ask-bg-steps">
            {steps.map((step) => (
              <li key={`${step.sequence}-${step.kind}`}>
                <strong>{step.toolName ?? step.kind.replaceAll("_", " ")}</strong>
                {step.resultSummary ? <span> — {step.resultSummary}</span> : null}
                {step.sourceUrl ? (
                  <a href={step.sourceUrl} target="_blank" rel="noreferrer">
                    source
                  </a>
                ) : null}
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </article>
  );
}
