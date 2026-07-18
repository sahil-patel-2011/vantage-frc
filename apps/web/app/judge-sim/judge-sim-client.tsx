"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { judgeSimCategoryLabel, judgeSimVerdictLabel } from "../../lib/judge-sim";
import { JUDGE_SIM_CATEGORIES, type JudgeSimView } from "../../lib/judge-sim/compute-judge-sim";
import {
  JUDGE_SIM_RELATED_INCLUDE,
  classifyJudgeSimShell,
  formatJudgeSimMetric,
  formatJudgeSimReadiness,
  judgeSimNextActions,
  judgeSimRelatedLinks,
  judgeSimShellCopy,
  shouldShowJudgeSimSummaryTiles,
  type JudgeSimNextAction,
  type JudgeSimShellKind,
} from "../../lib/judge-sim/judge-sim-related";
import type { JudgeSimCategory, JudgeSimVerdict } from "../../lib/judge-sim/types";
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./judge-sim.css";

function verdictTone(verdict: JudgeSimVerdict): string {
  if (verdict === "well_backed") return "good";
  if (verdict === "partially_backed") return "setup";
  return "demo";
}

type LiveView = Extract<JudgeSimView, { status: "live" }>;

function JudgeSimRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = judgeSimRelatedLinks(orgId, {
    include: [...JUDGE_SIM_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related judge-sim-related" aria-label="Related business tools">
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

function JudgeSimNextActionsPanel({ actions }: { actions: JudgeSimNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section
      className="app-card soft-panel edc-next-actions judge-sim-next-actions"
      aria-label="Next actions"
    >
      <header>
        <h2>Next actions</h2>
        <p className="app-muted">Community Impact, Impact Essay, and Awards — never DEMO judge metrics.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <a className="app-button secondary" href={action.href}>
              Open
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

function JudgeSimShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: JudgeSimShellKind;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = judgeSimNextActions({ orgId, shell });
  const copy = judgeSimShellCopy(shell);
  const businessHref = hubHref("/business", "judge-sim", orgId);
  const impactHref = hubHref("/business", "impact", orgId);
  const essayHref = hubHref("/business", "impact-essay", orgId);
  const awardsHref = hubHref("/business", "evidence", orgId);

  return (
    <main className="module-page judge-sim-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={businessHref}>Business</a>
            {" / Judge-Pitch Simulator"}
          </>
        }
        title="Judge-Pitch Simulator"
        description={description}
      >
        <JudgeSimRelatedStrip orgId={orgId} />
      </PageHeader>
      {children}
      <EmptyState
        soft
        badge={
          shell === "setup"
            ? "Setup required"
            : shell === "error"
              ? "Unavailable"
              : shell === "empty"
                ? "No sessions yet"
                : copy.badge
        }
        badgeTone="setup"
        title={copy.title}
        description={error ?? copy.description}
        aria-busy={shell === "loading"}
      >
        {shell === "error" && onRetry ? (
          <button type="button" className="app-button secondary" onClick={onRetry}>
            Retry
          </button>
        ) : null}
        {shell === "setup" ? (
          <a className="app-button" href={orgId ? withOrgHref("/workspace", orgId) : "/workspace"}>
            Open Workspace
          </a>
        ) : null}
        {shell === "empty" ? (
          <>
            <a className="app-button" href={impactHref}>
              Open Community Impact
            </a>
            <a className="app-button secondary" href={essayHref}>
              Open Impact Essay
            </a>
            <a className="app-button secondary" href={awardsHref}>
              Open Awards
            </a>
          </>
        ) : null}
      </EmptyState>
      <JudgeSimNextActionsPanel actions={actions} />
    </main>
  );
}

export default function JudgeSimClient() {
  const [view, setView] = useState<JudgeSimView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);

  const load = useCallback((seasonOverride?: number) => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const seasonQuery = seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (seasonQuery) query.set("season", String(seasonQuery));
    void fetch(`/api/judge-sim${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as JudgeSimView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setFetchFailed(true);
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
      })
      .catch(() => setFetchFailed(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const orgId = view && "orgId" in view ? view.orgId : null;
  const sessionCount = view?.status === "live" ? view.sessions.length : 0;
  const evidenceCount = view?.status === "live" ? view.evidence.length : 0;
  const wellBackedCount = view?.status === "live" ? view.readiness.wellBackedCount : 0;
  const unbackedCount = view?.status === "live" ? view.readiness.unbackedCount : 0;
  const readinessScore = view?.status === "live" ? view.readiness.score : 0;

  const shell = classifyJudgeSimShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId: view?.status === "live" ? view.orgId : view?.status === "setup_required" ? view.orgId : null,
    sessionCount,
  });
  const shellCopy = judgeSimShellCopy(shell);
  const nextActions = judgeSimNextActions({
    orgId,
    shell,
    sessionCount,
    evidenceCount,
  });
  const relatedLinks = judgeSimRelatedLinks(orgId, {
    include: [...JUDGE_SIM_RELATED_INCLUDE],
  });
  const businessHref = hubHref("/business", "judge-sim", orgId);
  const impactHref = hubHref("/business", "impact", orgId);
  const essayHref = hubHref("/business", "impact-essay", orgId);
  const awardsHref = hubHref("/business", "evidence", orgId);

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/judge-sim", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        });
        const data = (await response.json()) as JudgeSimView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, season, busy],
  );

  if (shell === "loading") {
    return <JudgeSimShell description={shellCopy.description} orgId={null} shell="loading" />;
  }

  if (shell === "error") {
    return (
      <JudgeSimShell
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        onRetry={() => load()}
      />
    );
  }

  if (shell === "setup") {
    return (
      <JudgeSimShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      >
        {view?.status === "setup_required" && view.steps.length > 0 ? (
          <ol className="strategy-setup-steps">
            {view.steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <span>{step.detail}</span>
                </div>
                <a href={step.href}>Open</a>
              </li>
            ))}
          </ol>
        ) : null}
      </JudgeSimShell>
    );
  }

  if (view?.status !== "live") {
    return <JudgeSimShell description={shellCopy.description} orgId={orgId} shell="setup" />;
  }

  return (
    <main className="module-page judge-sim-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={businessHref}>Business</a>
            {" / Judge-Pitch Simulator"}
          </>
        }
        title="Judge-Pitch Simulator"
        description="Practice judge Q&A and get graded against your own logged evidence — any claim you can't back gets flagged before a real judge catches it. Never DEMO judge metrics. Cross-check Community Impact, Impact Essay, and Awards."
      >
        <div className="judge-sim-header-actions">
          {view.seasons.length > 0 ? (
            <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
              Season
              <select
                value={season ?? view.seasonYear}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  setSeason(next);
                  load(next);
                }}
              >
                {view.seasons.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {relatedLinks.map((link) => (
            <a key={link.id} className="app-button secondary" href={link.href}>
              {link.label}
            </a>
          ))}
        </div>
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      <JudgeSimNextActionsPanel actions={nextActions} />

      {shouldShowJudgeSimSummaryTiles(sessionCount) ? (
        <section className="judge-sim-stats" aria-label="Judge-Pitch counts">
          <div>
            <strong>{formatJudgeSimReadiness(readinessScore, sessionCount, true)}</strong>
            <span className="app-muted" style={{ display: "block" }}>
              Well-backed share
            </span>
          </div>
          <div>
            <strong>{formatJudgeSimMetric(sessionCount, true)}</strong>
            <span className="app-muted" style={{ display: "block" }}>
              Sessions graded
            </span>
          </div>
          <div>
            <strong>{formatJudgeSimMetric(wellBackedCount, true)}</strong>
            <span className="app-muted" style={{ display: "block" }}>
              Well backed
            </span>
          </div>
          <div>
            <strong>{formatJudgeSimMetric(unbackedCount, true)}</strong>
            <span className="app-muted" style={{ display: "block" }}>
              Unbacked
            </span>
          </div>
          <div>
            <strong>{formatJudgeSimMetric(evidenceCount, true)}</strong>
            <span className="app-muted" style={{ display: "block" }}>
              Evidence logged
            </span>
          </div>
        </section>
      ) : null}

      {shell === "empty" ? (
        <EmptyState
          soft
          badge="No sessions yet"
          badgeTone="setup"
          title={shellCopy.title}
          description={shellCopy.description}
        >
          <a className="app-button" href={impactHref}>
            Open Community Impact
          </a>
          <a className="app-button secondary" href={essayHref}>
            Open Impact Essay
          </a>
          <a className="app-button secondary" href={awardsHref}>
            Open Awards
          </a>
        </EmptyState>
      ) : null}

      <div className="judge-sim-layout">
        <RunSessionForm busy={busy} mutate={mutate} />
        <SessionsList view={view} busy={busy} mutate={mutate} />
        <EvidenceLogForm busy={busy} mutate={mutate} />
        <EvidenceList view={view} busy={busy} mutate={mutate} />
        <Panel className="judge-sim-tip" aria-label="Judge-Pitch tip">
          <span className="eyebrow">Grounding path</span>
          <p className="app-muted" style={{ marginTop: 8 }}>
            Keep outreach facts in <a href={impactHref}>Community Impact</a>, draft award language in{" "}
            <a href={essayHref}>Impact Essay</a>, and upload packets in <a href={awardsHref}>Awards</a> —
            never invent DEMO verdicts, readiness scores, or evidence.
          </p>
        </Panel>
      </div>
    </main>
  );
}

function RunSessionForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const [category, setCategory] = useState<JudgeSimCategory>("technical");
  const [question, setQuestion] = useState("");
  const [answerText, setAnswerText] = useState("");

  return (
    <Panel
      id="judge-sim-session"
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!answerText.trim()) return;
        mutate({
          action: "run-session",
          category,
          question: question || undefined,
          answerText,
        });
        setQuestion("");
        setAnswerText("");
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Ask a judge question</h2>
      <p className="app-muted" style={{ margin: 0 }}>
        Leave the question blank to get one picked for you from the judging category, then answer it like you would
        in a real interview. Your answer is graded against evidence you&apos;ve logged below — never DEMO verdicts.
      </p>
      <FormGrid min={160}>
        <FormRow label="Category">
          <select value={category} onChange={(event) => setCategory(event.target.value as JudgeSimCategory)}>
            {JUDGE_SIM_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {judgeSimCategoryLabel(cat)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Question (optional)">
          <input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Leave blank for a picked question" />
        </FormRow>
      </FormGrid>
      <FormRow label="Your answer">
        <textarea
          value={answerText}
          onChange={(event) => setAnswerText(event.target.value)}
          rows={4}
          placeholder="Answer like you're in front of judges…"
          required
        />
      </FormRow>
      <div>
        <button type="submit" className="app-button" disabled={busy || !answerText.trim()}>
          Grade answer
        </button>
      </div>
    </Panel>
  );
}

function SessionsList({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.sessions.length === 0) {
    return (
      <EmptyState
        soft
        badge="No sessions yet"
        badgeTone="setup"
        title="Run your first judge Q&A"
        description="Ask yourself a judging question above and see which claims are backed by your evidence log — never DEMO verdicts."
      />
    );
  }
  return (
    <Panel id="judge-sim-sessions">
      <h2 style={{ marginTop: 0 }}>Graded sessions</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 12 }}>
        {view.sessions.slice(0, 20).map((item) => (
          <li key={item.id} style={{ display: "grid", gap: 4 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
              <div>
                <span className={`app-badge ${verdictTone(item.verdict)}`}>{judgeSimVerdictLabel(item.verdict)}</span>
                <strong style={{ display: "block", marginTop: 4 }}>{item.question}</strong>
                <small className="app-muted" style={{ display: "block" }}>
                  {judgeSimCategoryLabel(item.category)} · confidence {Math.round(item.confidence * 100)}%
                </small>
              </div>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm("Delete this session?")) {
                    mutate({ action: "delete-session", sessionId: item.id });
                  }
                }}
              >
                Delete
              </button>
            </div>
            <p style={{ margin: 0 }}>{item.answerText}</p>
            <small className="app-muted">{item.feedback}</small>
            {item.flaggedClaims.length > 0 ? (
              <div>
                <strong className="app-muted">Unbackable claims</strong>
                <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                  {item.flaggedClaims.map((claim) => (
                    <li key={claim}>{claim}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function EvidenceLogForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      title: "",
      claim: "",
      category: "technical" as JudgeSimCategory,
      sourceUrl: "",
      occurredOn: "",
      tags: "",
    }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
      id="judge-sim-evidence"
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.title.trim() || !form.claim.trim()) return;
        mutate({
          action: "log-evidence",
          title: form.title,
          claim: form.claim,
          category: form.category,
          sourceUrl: form.sourceUrl || undefined,
          occurredOn: form.occurredOn || undefined,
          tags: form.tags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Log evidence</h2>
      <p className="app-muted" style={{ margin: 0 }}>
        Facts you can actually point to for judges — numbers, events, outcomes. Answers are only graded as
        &quot;backed&quot; against what&apos;s logged here — never DEMO evidence.
      </p>
      <FormGrid min={160}>
        <FormRow label="Title">
          <input value={form.title} onChange={set("title")} placeholder="Regional STEM night" required />
        </FormRow>
        <FormRow label="Category">
          <select value={form.category} onChange={set("category")}>
            {JUDGE_SIM_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {judgeSimCategoryLabel(category)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Date (optional)">
          <input type="date" value={form.occurredOn} onChange={set("occurredOn")} />
        </FormRow>
        <FormRow label="Source URL (optional)">
          <input value={form.sourceUrl} onChange={set("sourceUrl")} placeholder="https://…" />
        </FormRow>
        <FormRow label="Tags (comma-separated, optional)">
          <input value={form.tags} onChange={set("tags")} placeholder="outreach, stem" />
        </FormRow>
      </FormGrid>
      <FormRow label="Claim / fact">
        <textarea
          value={form.claim}
          onChange={set("claim")}
          rows={2}
          placeholder="We ran a STEM outreach night reaching 300 local elementary students."
          required
        />
      </FormRow>
      <div>
        <button type="submit" className="app-button" disabled={busy || !form.title.trim() || !form.claim.trim()}>
          Log evidence
        </button>
      </div>
    </Panel>
  );
}

function EvidenceList({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.evidence.length === 0) {
    return (
      <EmptyState
        soft
        badge="No evidence yet"
        badgeTone="setup"
        title="Log your first piece of evidence"
        description="Without logged evidence, every claim in an answer will be flagged as unbacked — never invent DEMO facts."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Evidence log</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.evidence.slice(0, 30).map((item) => (
          <li key={item.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
            <div>
              <strong>{item.title}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                {judgeSimCategoryLabel(item.category)}
                {item.occurredOn ? ` · ${item.occurredOn}` : ""}
                {item.tags.length ? ` · ${item.tags.join(", ")}` : ""}
              </small>
              <small className="app-muted">{item.claim}</small>
            </div>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Delete "${item.title}"?`)) {
                  mutate({ action: "delete-evidence", evidenceId: item.id });
                }
              }}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
