"use client";

/**
 * Plan mode review: the agent proposed an ordered list of tool calls WITHOUT
 * running them. A mentor reads each step's dry run, unticks anything they do
 * not want, edits arguments if needed, answers the agent's questions, and
 * approves. Execution then runs the approved steps one at a time through the
 * ordinary tool executor (no model in the loop) and this same panel shows the
 * per-step outcome from cad_job_steps.
 *
 * Replaces the old "manipulation studio" composer, which appended free-form
 * operations to a job pipeline no page could reach.
 */

import { useEffect, useMemo, useState } from "react";

export type PlanReviewStep = {
  index: number;
  title: string;
  detail: string;
  tool?: string;
  args?: Record<string, unknown>;
  dryRun?: string;
  sequence?: number;
};

export type PlanRunStep = {
  sequence: number;
  index: number;
  tool: string;
  title: string;
  status: "planned" | "running" | "completed" | "failed" | "skipped" | "cancelled";
  approvalStatus: "pending" | "approved" | "rejected";
  featureId: string | null;
  error: string | null;
  narration: string | null;
  vaultHref: string | null;
};

export type PlanDecision = { sequence: number; approved: boolean; args?: Record<string, unknown> };

const RUN_STATUS_LABELS: Record<PlanRunStep["status"], string> = {
  planned: "Waiting",
  running: "Running…",
  completed: "Done",
  failed: "Failed",
  skipped: "Skipped",
  cancelled: "Cancelled",
};

function toolLabel(tool: string): string {
  return tool.replace(/^onshape_/, "").replaceAll("_", " ");
}

/** Review the proposal: tick/untick steps, edit args, answer questions, approve. */
export function CadPlanReview({
  steps,
  questions,
  answers: initialAnswers,
  busy,
  onApprove,
  onDiscard,
}: {
  steps: PlanReviewStep[];
  questions: string[];
  answers: string[];
  busy: boolean;
  onApprove: (decisions: PlanDecision[], answers: string[]) => Promise<void>;
  onDiscard: () => Promise<void>;
}) {
  const toolSteps = useMemo(() => steps.filter((step) => step.tool && step.sequence), [steps]);
  const [approved, setApproved] = useState<Record<number, boolean>>({});
  const [argsText, setArgsText] = useState<Record<number, string>>({});
  const [argsError, setArgsError] = useState<Record<number, string>>({});
  const [editing, setEditing] = useState<number | null>(null);
  const [answers, setAnswers] = useState<string[]>(initialAnswers);

  // A new plan (different sequences) resets the checkboxes to "all approved".
  const signature = toolSteps.map((step) => step.sequence).join(",");
  useEffect(() => {
    const next: Record<number, boolean> = {};
    const text: Record<number, string> = {};
    for (const step of toolSteps) {
      next[step.sequence!] = true;
      text[step.sequence!] = JSON.stringify(step.args ?? {}, null, 2);
    }
    setApproved(next);
    setArgsText(text);
    setArgsError({});
    setEditing(null);
  }, [signature]);
  useEffect(() => setAnswers(questions.map((_, index) => initialAnswers[index] ?? "")), [questions, initialAnswers]);

  const approvedCount = toolSteps.filter((step) => approved[step.sequence!]).length;
  const unanswered = questions.filter((_, index) => !answers[index]?.trim()).length;

  function submit() {
    const decisions: PlanDecision[] = [];
    const errors: Record<number, string> = {};
    for (const step of toolSteps) {
      const sequence = step.sequence!;
      let args: Record<string, unknown> | undefined;
      const raw = argsText[sequence];
      if (raw !== undefined && raw !== JSON.stringify(step.args ?? {}, null, 2)) {
        try {
          const parsed = JSON.parse(raw) as unknown;
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Arguments must be a JSON object");
          args = parsed as Record<string, unknown>;
        } catch (error) {
          errors[sequence] = error instanceof Error ? error.message : "Arguments must be valid JSON";
        }
      }
      decisions.push({ sequence, approved: Boolean(approved[sequence]), ...(args ? { args } : {}) });
    }
    setArgsError(errors);
    if (Object.keys(errors).length) return;
    void onApprove(decisions, answers);
  }

  return (
    <div className="cad-plan-panel" aria-label="Build plan review">
      <b>Build plan — nothing has run in Onshape yet</b>
      <p className="cad-agent-hint">
        Each step is one tool call. Untick a step to skip it; expand it to edit the arguments. Approved steps run in
        order, one at a time, and the viewport refreshes after each.
      </p>
      <ol className="cad-plan-steps cad-plan-steps--review">
        {steps.map((step) => {
          const sequence = step.sequence;
          const executable = Boolean(step.tool && sequence);
          const checked = executable ? Boolean(approved[sequence!]) : false;
          return (
            <li key={`plan-step-${step.index}`} className={executable && !checked ? "cad-plan-step--skipped" : undefined}>
              <label className="cad-plan-step-head">
                {executable ? (
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={busy}
                    onChange={(event) => setApproved((prev) => ({ ...prev, [sequence!]: event.target.checked }))}
                    aria-label={`Approve step ${step.index}`}
                  />
                ) : (
                  <span className="cad-plan-step-manual" title="Narrative step — nothing to execute">
                    —
                  </span>
                )}
                <span className="cad-plan-step-title">
                  {step.title}
                  {step.tool ? <code className="cad-plan-step-tool">{toolLabel(step.tool)}</code> : null}
                </span>
              </label>
              {step.dryRun ? <span className="cad-plan-dryrun">{step.dryRun}</span> : null}
              {step.detail ? <span className="cad-plan-detail">{step.detail}</span> : null}
              {executable ? (
                <div className="cad-plan-args">
                  <button
                    type="button"
                    className="cad-plan-args-toggle"
                    aria-expanded={editing === sequence}
                    onClick={() => setEditing((prev) => (prev === sequence ? null : sequence!))}
                  >
                    {editing === sequence ? "Hide arguments" : "Edit arguments"}
                  </button>
                  {editing === sequence ? (
                    <>
                      <textarea
                        rows={Math.min(10, Math.max(3, (argsText[sequence!] ?? "").split("\n").length))}
                        value={argsText[sequence!] ?? ""}
                        spellCheck={false}
                        disabled={busy}
                        aria-label={`Arguments for step ${step.index}`}
                        onChange={(event) => setArgsText((prev) => ({ ...prev, [sequence!]: event.target.value }))}
                      />
                      {argsError[sequence!] ? (
                        <span className="cad-agent-error" role="alert">
                          {argsError[sequence!]}
                        </span>
                      ) : null}
                    </>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
      {questions.length ? (
        <div className="cad-plan-questions">
          <b>Questions from the agent</b>
          {questions.map((question, index) => (
            <label key={`plan-q-${index}`}>
              <span>{question}</span>
              <input
                value={answers[index] ?? ""}
                placeholder="Answer in mm where relevant"
                disabled={busy}
                onChange={(event) => setAnswers((prev) => prev.map((item, i) => (i === index ? event.target.value : item)))}
              />
            </label>
          ))}
          {unanswered ? (
            <span className="cad-agent-hint">
              {unanswered} unanswered — the plan left those dimensions out rather than guessing; answer and send a revision, or
              approve the steps that do not need them.
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="cad-plan-actions">
        <button className="app-button" type="button" disabled={busy || approvedCount === 0} onClick={submit}>
          Approve {approvedCount === toolSteps.length ? "all" : approvedCount} &amp; build
        </button>
        <button className="app-button secondary" type="button" disabled={busy} onClick={() => void onDiscard()}>
          Discard plan
        </button>
        <span className="cad-agent-hint">Or send a message below to revise the plan.</span>
      </div>
    </div>
  );
}

/** Live and historical outcome of an approved plan, from cad_job_steps. */
export function CadPlanRun({
  run,
  running,
  busy,
  onContinue,
  onRetry,
  onClear,
}: {
  run: PlanRunStep[];
  running: boolean;
  busy: boolean;
  onContinue: () => Promise<void>;
  onRetry: (sequence: number) => Promise<void>;
  onClear: () => Promise<void>;
}) {
  const approvedRun = run.filter((step) => step.approvalStatus !== "rejected");
  const completed = approvedRun.filter((step) => step.status === "completed").length;
  const failed = approvedRun.filter((step) => step.status === "failed");
  const waiting = approvedRun.filter((step) => step.approvalStatus === "approved" && step.status === "planned");
  const finished = !running && waiting.length === 0;
  return (
    <div className="cad-plan-panel" aria-label="Plan run" aria-live="polite">
      <b>
        {running
          ? `Building — ${completed}/${approvedRun.length} steps done`
          : finished
            ? `Plan run finished — ${completed}/${approvedRun.length} steps built${failed.length ? `, ${failed.length} failed` : ""}`
            : `Plan run paused — ${completed}/${approvedRun.length} done, ${waiting.length} waiting`}
      </b>
      <ol className="cad-plan-steps cad-plan-run">
        {run.map((step) => (
          <li key={`run-${step.sequence}`} className={`cad-plan-run-step cad-plan-run-step--${step.status}`}>
            <span className="cad-plan-run-status">
              {step.approvalStatus === "rejected" ? "Skipped" : RUN_STATUS_LABELS[step.status]}
            </span>
            <span className="cad-plan-step-title">
              {step.narration ?? step.title}
              <code className="cad-plan-step-tool">{toolLabel(step.tool)}</code>
            </span>
            {step.error ? <span className="cad-plan-run-error">{step.error}</span> : null}
            {step.vaultHref ? (
              <a className="cad-plan-run-link" href={step.vaultHref}>
                Saved to vault
              </a>
            ) : null}
            {step.status === "failed" && !running ? (
              <button type="button" className="cad-plan-args-toggle" disabled={busy} onClick={() => void onRetry(step.sequence)}>
                Retry step
              </button>
            ) : null}
          </li>
        ))}
      </ol>
      <div className="cad-plan-actions">
        {!running && waiting.length ? (
          <button className="app-button" type="button" disabled={busy} onClick={() => void onContinue()}>
            Continue ({waiting.length} left)
          </button>
        ) : null}
        {finished ? (
          <button className="app-button secondary" type="button" disabled={busy} onClick={() => void onClear()}>
            Clear
          </button>
        ) : null}
      </div>
    </div>
  );
}
