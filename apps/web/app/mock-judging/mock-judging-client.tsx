"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import {
  MOCK_JUDGING_AWARD_CATEGORIES,
  mockJudgingAwardCategoryLabel,
  mockJudgingCriterionLabel,
} from "../../lib/mock-judging";
import type { MockJudgingView } from "../../lib/mock-judging/compute-mock-judging";
import type { MockJudgingAwardCategory, MockJudgingCriterion } from "../../lib/mock-judging/types";
import { renderReceiptFrom, type RenderReceipt } from "../../lib/ai-render/outcome";
import { RenderAttribution } from "../../components/ui/render-attribution";

function scoreTone(score: number): string {
  if (score >= 4) return "good";
  if (score >= 2.8) return "setup";
  return "demo";
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

type LiveView = Extract<MockJudgingView, { status: "live" }>;

export default function MockJudgingClient() {
  const [view, setView] = useState<MockJudgingView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [renderReceipt, setRenderReceipt] = useState<RenderReceipt | null>(null);
  const [season, setSeason] = useState<number | null>(null);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback((seasonOverride?: number) => {
    setFetchFailed(false);
    setErrorStatus(null);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const seasonQuery = seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (seasonQuery) query.set("season", String(seasonQuery));
    void fetch(`/api/mock-judging${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as MockJudgingView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setErrorStatus(response.status);
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

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/mock-judging", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        });
        const data = (await response.json()) as MockJudgingView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
        const receipt = renderReceiptFrom(data);
        if (receipt) setRenderReceipt(receipt);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, season, busy],
  );

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/team?orgId=${encodeURIComponent(orgId)}` : "/team"}>Team</a>
            {" / Mock Judging"}
          </>
        }
        title="Mock Judging"
        description="Run practice judging sessions with a rubric judge computed from your own prep notes — feedback on substance, specificity, evidence grounding, clarity, and confidence before you're in front of real judges."
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          {view?.status === "live" && view.seasons.length > 0 ? (
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
        </div>
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      <RenderAttribution receipt={renderReceipt} feature="mock_judging" />

      {fetchFailed ? (
        (() => {
          const kind = classifyLoadFailure({
            status: errorStatus,
            message: error,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          });
          const copy = loadFailureCopy(kind, {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message: error,
          });
          return (
            <EmptyState title={copy.title} description={copy.description}>
              {copy.primary ? (
                <a className="app-button" href={copy.primary.href}>
                  {copy.primary.label}
                </a>
              ) : null}
              {copy.showRetry ? (
                <button type="button" className="app-button secondary" onClick={() => load()}>
                  Retry
                </button>
              ) : null}
            </EmptyState>
          );
        })()
      ) : view == null ? (
        <EmptyState title="Loading…" description="Checking your workspace." aria-busy />
      ) : view.status === "setup_required" ? (
        <EmptyState badge="Setup required" badgeTone="setup" title={view.message}>
          <ol className="strategy-setup-steps">
            {view.steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <span>{step.detail}</span>
                </div>
                <a href={step.href} aria-label={step.label}>Open</a>
              </li>
            ))}
          </ol>
        </EmptyState>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <ReadinessPanel view={view} />
          <RunSessionForm busy={busy} mutate={mutate} />
          <SessionsList view={view} busy={busy} mutate={mutate} />
          <PrepNoteForm busy={busy} mutate={mutate} />
          <PrepNotesList view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function ReadinessPanel({ view }: { view: LiveView }) {
  const { readiness } = view;
  const tiles = [
    { label: "Sessions scored", value: String(readiness.totalSessions) },
    { label: "Strong (4+/5)", value: String(readiness.strongSessionCount) },
    { label: "Needs work (<2.8/5)", value: String(readiness.weakSessionCount) },
    { label: "Categories covered", value: String(readiness.categoriesCovered) },
    { label: "Prep notes logged", value: String(readiness.notesCount) },
  ];
  return (
    <Panel aria-label="Mock judging readiness">
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <h2 style={{ margin: "0" }}>Judging readiness</h2>
          <small className="app-muted">Mean rubric score across this season's practice sessions</small>
        </div>
        <strong style={{ fontSize: "2rem" }}>{pct(readiness.score)}</strong>
      </header>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
          gap: 12,
          marginTop: 12,
        }}
      >
        {tiles.map((tile) => (
          <div key={tile.label}>
            <strong style={{ fontSize: "1.4rem", display: "block" }}>{tile.value}</strong>
            <span className="app-muted">{tile.label}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function RunSessionForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const [awardCategory, setAwardCategory] = useState<MockJudgingAwardCategory>("general");
  const [question, setQuestion] = useState("");
  const [answerText, setAnswerText] = useState("");

  return (
    <Panel
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!answerText.trim()) return;
        mutate({
          action: "run-session",
          awardCategory,
          question: question || undefined,
          answerText,
        });
        setQuestion("");
        setAnswerText("");
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Run a mock judging round</h2>
      <p className="app-muted" style={{ margin: 0 }}>
        Leave the question blank to get one picked for you from the award category, then answer it like you would in
        front of judges. The rubric judge scores your answer deterministically and grounds feedback in your logged prep notes.
      </p>
      <FormGrid min={160}>
        <FormRow label="Award category">
          <select value={awardCategory} onChange={(event) => setAwardCategory(event.target.value as MockJudgingAwardCategory)}>
            {MOCK_JUDGING_AWARD_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {mockJudgingAwardCategoryLabel(category)}
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
          Score answer
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
        badge="No sessions yet"
        badgeTone="setup"
        title="Run your first mock judging round"
        description="Answer a judging question above and get a rubric-scored breakdown across five criteria."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Scored sessions</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 12 }}>
        {view.sessions.slice(0, 20).map((item) => (
          <li key={item.id} style={{ display: "grid", gap: 4 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
              <div>
                <span className={`app-badge ${scoreTone(item.overallScore)}`}>{item.overallScore}/5</span>
                <strong style={{ display: "block", marginTop: 4 }}>{item.question}</strong>
                <small className="app-muted" style={{ display: "block" }}>
                  {mockJudgingAwardCategoryLabel(item.awardCategory)}
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
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              {(Object.entries(item.criteriaScores) as Array<[MockJudgingCriterion, number]>).map(([criterion, value]) => (
                <small key={criterion} className="app-muted">
                  {mockJudgingCriterionLabel(criterion)}: {value}/5
                </small>
              ))}
            </div>
            <small className="app-muted">{item.feedback}</small>
            {item.improvements.length > 0 ? (
              <div>
                <strong className="app-muted">Improve</strong>
                <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                  {item.improvements.map((tip) => (
                    <li key={tip}>{tip}</li>
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

function PrepNoteForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      title: "",
      note: "",
      awardCategory: "general" as MockJudgingAwardCategory,
      tags: "",
    }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.title.trim() || !form.note.trim()) return;
        mutate({
          action: "log-note",
          title: form.title,
          note: form.note,
          awardCategory: form.awardCategory,
          tags: form.tags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Log a prep note</h2>
      <p className="app-muted" style={{ margin: 0 }}>
        Talking points and facts your team can point to for judges. Answers are scored higher for evidence grounding
        when they overlap with what's logged here.
      </p>
      <FormGrid min={160}>
        <FormRow label="Title">
          <input value={form.title} onChange={set("title")} placeholder="Regional STEM night" required />
        </FormRow>
        <FormRow label="Award category">
          <select value={form.awardCategory} onChange={set("awardCategory")}>
            {MOCK_JUDGING_AWARD_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {mockJudgingAwardCategoryLabel(category)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Tags (comma-separated, optional)">
          <input value={form.tags} onChange={set("tags")} placeholder="outreach, stem" />
        </FormRow>
      </FormGrid>
      <FormRow label="Note">
        <textarea
          value={form.note}
          onChange={set("note")}
          rows={2}
          placeholder="We ran a STEM outreach night reaching 300 local elementary students."
          required
        />
      </FormRow>
      <div>
        <button type="submit" className="app-button" disabled={busy || !form.title.trim() || !form.note.trim()}>
          Log note
        </button>
      </div>
    </Panel>
  );
}

function PrepNotesList({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.notes.length === 0) {
    return (
      <EmptyState
        badge="No prep notes yet"
        badgeTone="setup"
        title="Log your first prep note"
        description="Without logged notes, the rubric judge can't ground evidence-grounding scores in anything specific."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Prep notes</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.notes.slice(0, 30).map((item) => (
          <li key={item.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
            <div>
              <strong>{item.title}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                {mockJudgingAwardCategoryLabel(item.awardCategory)}
                {item.tags.length ? ` · ${item.tags.join(", ")}` : ""}
              </small>
              <small className="app-muted">{item.note}</small>
            </div>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Delete "${item.title}"?`)) {
                  mutate({ action: "delete-note", noteId: item.id });
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
