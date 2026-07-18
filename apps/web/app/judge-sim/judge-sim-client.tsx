"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { judgeSimCategoryLabel, judgeSimVerdictLabel } from "../../lib/judge-sim";
import { JUDGE_SIM_CATEGORIES, type JudgeSimView } from "../../lib/judge-sim/compute-judge-sim";
import type { JudgeSimCategory, JudgeSimVerdict } from "../../lib/judge-sim/types";

function verdictTone(verdict: JudgeSimVerdict): string {
  if (verdict === "well_backed") return "good";
  if (verdict === "partially_backed") return "setup";
  return "demo";
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

type LiveView = Extract<JudgeSimView, { status: "live" }>;

export default function JudgeSimClient() {
  const [view, setView] = useState<JudgeSimView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);

  const orgId = view && "orgId" in view ? view.orgId : null;

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

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/business?orgId=${encodeURIComponent(orgId)}` : "/business"}>Business</a>
            {" / Judge-Pitch Simulator"}
          </>
        }
        title="Judge-Pitch Simulator"
        description="Practice judge Q&A and get graded against your own logged evidence — any claim you can't back gets flagged before a real judge catches it."
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

      {fetchFailed ? (
        <EmptyState
          title="Could not load the judge-pitch simulator"
          description="A network or server issue prevented loading. Try again."
        >
          <button type="button" className="app-button secondary" onClick={() => load()}>
            Retry
          </button>
        </EmptyState>
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
                <a href={step.href}>Open</a>
              </li>
            ))}
          </ol>
        </EmptyState>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <ReadinessPanel view={view} />
          <RunSessionForm busy={busy} mutate={mutate} />
          <SessionsList view={view} busy={busy} mutate={mutate} />
          <EvidenceLogForm busy={busy} mutate={mutate} />
          <EvidenceList view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function ReadinessPanel({ view }: { view: LiveView }) {
  const { readiness } = view;
  const tiles = [
    { label: "Sessions graded", value: String(readiness.totalSessions) },
    { label: "Well backed", value: String(readiness.wellBackedCount) },
    { label: "Unbacked", value: String(readiness.unbackedCount) },
    { label: "Evidence logged", value: String(readiness.evidenceCount) },
  ];
  return (
    <Panel aria-label="Judge-readiness score">
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <h2 style={{ margin: "0" }}>Judge-readiness</h2>
          <small className="app-muted">Share of graded answers judged well-backed this season</small>
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
  const [category, setCategory] = useState<JudgeSimCategory>("technical");
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
        in a real interview. Your answer is graded against evidence you've logged below.
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
        badge="No sessions yet"
        badgeTone="setup"
        title="Run your first judge Q&A"
        description="Ask yourself a judging question above and see which claims are backed by your evidence log."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Graded sessions</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 12 }}>
        {view.sessions.slice(0, 20).map((item) => (
          <li key={item.id} style={{ display: "grid", gap: 4 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
              <div>
                <span className={`app-badge ${verdictTone(item.verdict)}`}>{judgeSimVerdictLabel(item.verdict)}</span>
                <strong style={{ display: "block", marginTop: 4 }}>{item.question}</strong>
                <small className="app-muted" style={{ display: "block" }}>
                  {judgeSimCategoryLabel(item.category)} · confidence {pct(item.confidence)}
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
        Facts you can actually point to for judges — numbers, events, outcomes. Answers are only graded as "backed"
        against what's logged here.
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
        badge="No evidence yet"
        badgeTone="setup"
        title="Log your first piece of evidence"
        description="Without logged evidence, every claim in an answer will be flagged as unbacked."
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
