"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AiHubRelated } from "../../components/ai-hub-related";
import { WhyPanel } from "../../components/why-panel";
import { narrateAgentRun, narrationCoverage } from "../../lib/agent-narration/narration";
import { MeteredAiCutoffBanner } from "../../components/metered-ai-cutoff-banner";
import { SponsoredPromoBanner } from "../../components/sponsored-promo-banner";
import { AIAttribution, ModelProvenance } from "../../components/ui";
import { resolveCutoffErrorCode, UsageCutoffBanner } from "../../components/usage-cutoff-banner";
import { hubHref } from "../../lib/nav/hubs";
import "./autonomous-agent.css";

type RunSummary = {
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

type StepRow = {
  id?: string;
  sequence: number;
  kind: string;
  toolName?: string | null;
  argsSummary?: string | null;
  resultSummary?: string | null;
  resultExcerpt?: string | null;
  sourceUrl?: string | null;
  status: string;
};

type Shell = "loading" | "ready" | "empty" | "setup_required" | "auth_required" | "error";

function classifyShell(input: {
  loading: boolean;
  status?: number | null;
  error?: string | null;
  code?: string | null;
}): Shell {
  if (input.loading) return "loading";
  if (input.status === 401 || /auth|sign.?in/i.test(input.error ?? "")) return "auth_required";
  if (input.code === "setup_required" || input.status === 503) return "setup_required";
  if (input.error?.trim()) return "error";
  return "ready";
}

export function AutonomousAgentPanel({ orgId }: { orgId: string }) {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [steps, setSteps] = useState<StepRow[]>([]);
  const [selectedRun, setSelectedRun] = useState<RunSummary | null>(null);
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [httpStatus, setHttpStatus] = useState<number | null>(null);
  const [cutoffCode, setCutoffCode] = useState<string | null>(null);
  const [webSearchConfigured, setWebSearchConfigured] = useState(false);
  const [webBrowseEnabled, setWebBrowseEnabled] = useState(true);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    setLoading(true);
    setError(null);
    setErrorCode(null);
    try {
      const response = await fetch(`/api/agent/autonomous?orgId=${encodeURIComponent(orgId)}`);
      setHttpStatus(response.status);
      const data = (await response.json()) as {
        runs?: RunSummary[];
        error?: string;
        code?: string;
        webSearchConfigured?: boolean;
        webBrowseEnabled?: boolean;
      };
      if (!response.ok) {
        setError(data.error ?? "Could not load agent runs");
        setErrorCode(data.code ?? null);
        setCutoffCode(resolveCutoffErrorCode(response.status, data) ?? null);
        setRuns([]);
        return;
      }
      setRuns(data.runs ?? []);
      setWebSearchConfigured(Boolean(data.webSearchConfigured));
      setWebBrowseEnabled(data.webBrowseEnabled !== false);
      setCutoffCode(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load agent runs");
      setRuns([]);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  const loadRunDetail = useCallback(
    async (runId: string) => {
      const response = await fetch(
        `/api/agent/autonomous?orgId=${encodeURIComponent(orgId)}&runId=${encodeURIComponent(runId)}`,
      );
      const data = (await response.json()) as {
        run?: RunSummary | null;
        steps?: StepRow[];
        error?: string;
      };
      if (!response.ok) {
        setError(data.error ?? "Could not load run");
        return;
      }
      setSelectedId(runId);
      setSelectedRun(data.run ?? null);
      setSteps(data.steps ?? []);
    },
    [orgId],
  );

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  async function onRun() {
    const trimmed = goal.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    setErrorCode(null);
    setCutoffCode(null);
    try {
      const response = await fetch("/api/agent/autonomous", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, goal: trimmed, maxSteps: 8 }),
      });
      setHttpStatus(response.status);
      const data = (await response.json()) as {
        runId?: string;
        status?: string;
        finalAnswer?: string | null;
        steps?: StepRow[];
        run?: RunSummary | null;
        persistedSteps?: StepRow[];
        error?: string;
        code?: string;
        message?: string;
        setupRequired?: boolean;
        provider?: string;
        model?: string;
      };
      if (!response.ok) {
        setError(data.error ?? data.message ?? "Agent run failed");
        setErrorCode(data.code ?? null);
        setCutoffCode(resolveCutoffErrorCode(response.status, data) ?? null);
        return;
      }
      setGeneratedAt(new Date().toISOString());
      await loadRuns();
      if (data.runId) {
        setSelectedId(data.runId);
        setSelectedRun(
          data.run ?? {
            id: data.runId,
            goal: trimmed,
            status: data.status ?? "completed",
            provider: data.provider ?? null,
            model: data.model ?? null,
            stepCount: (data.persistedSteps ?? data.steps ?? []).length,
            finalAnswer: data.finalAnswer ?? null,
            errorClass: data.setupRequired ? "setup_required" : null,
            errorMessage: null,
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
          },
        );
        setSteps(data.persistedSteps ?? data.steps ?? []);
      }
      if (data.setupRequired || data.status === "setup_required") {
        setErrorCode("setup_required");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Agent run failed");
    } finally {
      setBusy(false);
    }
  }

  const shell = classifyShell({ loading, status: httpStatus, error, code: errorCode });
  const empty = !loading && runs.length === 0 && !selectedRun;
  /** Show-your-work narration derived from the persisted steps — never from invented reasoning. */
  const narrations = useMemo(() => narrateAgentRun(steps), [steps]);
  const coverage = useMemo(() => narrationCoverage(narrations), [narrations]);

  return (
    <div className="aa-page">
      <header className="aa-header">
        <div>
          <p className="aa-eyebrow">Autonomous agent</p>
          <h1>Goal → tools → answer</h1>
          <p>
            ReAct-style loop with allowlisted web fetch and optional search. Org facts and tool
            results are injected each step. Metered via feature=agent — never DEMO runs.
          </p>
        </div>
        <div className="aa-header-actions">
          <a className="app-button secondary" href={hubHref("/ai", "chat", orgId)}>
            Chat
          </a>
          <a className="app-button secondary" href={hubHref("/ai", "budgets", orgId)}>
            Budgets
          </a>
        </div>
      </header>

      <SponsoredPromoBanner orgId={orgId} />
      <MeteredAiCutoffBanner orgId={orgId} />
      {cutoffCode ? <UsageCutoffBanner orgId={orgId} errorCode={cutoffCode} compact /> : null}

      <section className="aa-setup" aria-label="Tool setup">
        <div className={webSearchConfigured ? "aa-pill ok" : "aa-pill warn"}>
          Search: {webSearchConfigured ? "configured" : "setup_required"}
        </div>
        <div className={webBrowseEnabled ? "aa-pill ok" : "aa-pill warn"}>
          Browse: {webBrowseEnabled ? "allowlisted HTTPS" : "disabled"}
        </div>
      </section>

      {shell === "auth_required" ? (
        <section className="app-card soft-panel aa-empty">
          <h2>Sign in required</h2>
          <p>Autonomous agent runs are org-scoped. Sign in, then reopen this tab.</p>
        </section>
      ) : null}

      {shell === "setup_required" && !selectedRun ? (
        <section className="app-card soft-panel aa-empty">
          <h2>Provider setup required</h2>
          <p>
            {error ??
              "Add a BYOK / managed / sponsored AI key under AI API keys, or configure BRAVE_SEARCH_API_KEY for web search."}
          </p>
            <a className="app-button" href={hubHref("/ai", "ai-keys", orgId)}>
            Open AI keys
          </a>
        </section>
      ) : null}

      {error && shell === "error" ? (
        <section className="app-card soft-panel aa-empty" role="alert">
          <h2>Agent error</h2>
          <p>{error}</p>
        </section>
      ) : null}

      <section className="aa-compose app-card soft-panel">
        <label htmlFor="aa-goal">Goal</label>
        <textarea
          id="aa-goal"
          rows={3}
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="e.g. Summarize the current FIRST game manual bumpers rule from the official docs site"
          disabled={busy}
          maxLength={4000}
        />
        <div className="aa-compose-actions">
          <button type="button" className="app-button" onClick={() => void onRun()} disabled={busy || !goal.trim()}>
            {busy ? "Running…" : "Run autonomous agent"}
          </button>
          <button type="button" className="app-button secondary" onClick={() => void loadRuns()} disabled={busy}>
            Refresh history
          </button>
        </div>
      </section>

      <div className="aa-grid">
        <section className="aa-history app-card soft-panel" aria-label="Past runs">
          <header>
            <h2>Past runs</h2>
            <p>Persisted in Neon with truncated step logs — never DEMO history.</p>
          </header>
          {loading ? <p className="aa-muted">Loading…</p> : null}
          {empty ? (
            <p className="aa-muted">No autonomous runs yet for this workspace.</p>
          ) : (
            <ul className="aa-run-list">
              {runs.map((run) => (
                <li key={run.id}>
                  <button
                    type="button"
                    className={selectedId === run.id ? "aa-run active" : "aa-run"}
                    onClick={() => void loadRunDetail(run.id)}
                  >
                    <strong>{run.goal.slice(0, 80)}{run.goal.length > 80 ? "…" : ""}</strong>
                    <span>
                      {run.status} · {run.stepCount} steps
                      {run.provider ? ` · ${run.provider}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="aa-detail app-card soft-panel" aria-label="Run detail">
          <header>
            <h2>Step log</h2>
            <p>Tools used, truncated results, and the final answer.</p>
          </header>
          {!selectedRun ? (
            <p className="aa-muted">Select a run or start a new goal.</p>
          ) : (
            <>
              <div className="aa-status-row">
                <span className={`aa-status aa-status--${selectedRun.status}`}>{selectedRun.status}</span>
              </div>
              {/* Which endpoint actually ran this goal. Sits above the step log so a
                  small-model notice is visible even when the run errored before an
                  answer. The run row is persisted, so this is never a guess. */}
              <ModelProvenance
                meta={{ provider: selectedRun.provider, modelId: selectedRun.model }}
              />
              {selectedRun.errorMessage ? (
                <p className="aa-error" role="status">
                  {selectedRun.errorClass ? `${selectedRun.errorClass}: ` : ""}
                  {selectedRun.errorMessage}
                </p>
              ) : null}
              <ol className="aa-steps">
                {steps.map((step) => (
                  <li key={`${step.sequence}-${step.kind}-${step.toolName ?? ""}`}>
                    <div className="aa-step-head">
                      <strong>
                        #{step.sequence} {step.kind}
                        {step.toolName ? ` · ${step.toolName}` : ""}
                      </strong>
                      <span>{step.status}</span>
                    </div>
                    {step.argsSummary ? <pre className="aa-pre">{step.argsSummary}</pre> : null}
                    {step.resultSummary ? <p>{step.resultSummary}</p> : null}
                    {step.sourceUrl ? (
                      <a href={step.sourceUrl} target="_blank" rel="noreferrer">
                        {step.sourceUrl}
                      </a>
                    ) : null}
                    {step.resultExcerpt ? (
                      <details>
                        <summary>Excerpt</summary>
                        <pre className="aa-pre">{step.resultExcerpt}</pre>
                      </details>
                    ) : null}
                  </li>
                ))}
              </ol>
              {narrations.length ? (
                <WhyPanel
                  narrations={narrations}
                  orgId={orgId}
                  title="Why the agent did this"
                  subtitle={`${coverage.total} step${coverage.total === 1 ? "" : "s"} · ${coverage.explained} with a reason the run actually recorded`}
                />
              ) : null}
              {selectedRun.finalAnswer ? (
                <article className="aa-answer">
                  <h3>Final answer</h3>
                  <p>{selectedRun.finalAnswer}</p>
                  {generatedAt ? (
                    <AIAttribution feature="agent" generatedAt={generatedAt} onRegenerate={() => void onRun()} />
                  ) : (
                    <AIAttribution
                      feature="agent"
                      generatedAt={selectedRun.finishedAt ?? selectedRun.startedAt}
                    />
                  )}
                </article>
              ) : null}
            </>
          )}
        </section>
      </div>

      <AiHubRelated orgId={orgId} active="agent" />
    </div>
  );
}

export default AutonomousAgentPanel;
