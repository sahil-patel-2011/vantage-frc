"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { decisionRecommendationLabel, testOutcomeLabel } from "../../lib/prototype-tracker";
import {
  TEST_OUTCOMES,
  type PrototypeTrackerView,
} from "../../lib/prototype-tracker/compute-prototype-tracker";
import type { DecisionRecommendation, DecisionStatus, TestOutcome } from "../../lib/prototype-tracker/types";

const OUTCOME_TONE: Record<TestOutcome, string> = {
  success: "good",
  partial: "setup",
  inconclusive: "demo",
  failure: "demo",
};

const RECOMMENDATION_TONE: Record<DecisionRecommendation, string> = {
  adopt: "good",
  iterate: "setup",
  needs_more_data: "demo",
  reject: "demo",
};

const STATUS_LABEL: Record<DecisionStatus, string> = {
  draft: "Draft",
  finalized: "Finalized",
};

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

type LiveView = Extract<PrototypeTrackerView, { status: "live" }>;

export default function PrototypeTrackerClient() {
  const [view, setView] = useState<PrototypeTrackerView | null>(null);
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
    void fetch(`/api/prototype-tracker${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as PrototypeTrackerView | { error?: string };
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
        const response = await fetch("/api/prototype-tracker", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        });
        const data = (await response.json()) as PrototypeTrackerView | { error?: string };
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
            <a href={orgId ? `/build?orgId=${encodeURIComponent(orgId)}` : "/build"}>Build</a>
            {" / Prototype Tracker"}
          </>
        }
        title="Prototype-to-Decision Tracker"
        description="Log a prototype test — hypothesis, outcome, metric vs. target — then draft the design decision and notebook entry it informs, grounded only in what you recorded."
      >
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
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        <EmptyState
          title="Could not load the prototype tracker"
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
          <LogTestForm busy={busy} mutate={mutate} />
          {view.tests.length > 0 ? (
            <TestsList view={view} busy={busy} mutate={mutate} />
          ) : (
            <EmptyState
              badge="No tests yet"
              badgeTone="setup"
              title="Log your first prototype test"
              description="Once logged, you can draft the decision record and notebook entry it informs."
            />
          )}
          <DecisionsList view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function TestsList({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Prototype tests</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.tests.map((test) => (
          <li key={test.id} className="app-card soft-panel" style={{ display: "grid", gap: 6 }}>
            <header style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
              <div>
                <span className={`app-badge ${OUTCOME_TONE[test.outcome]}`}>{testOutcomeLabel(test.outcome)}</span>
                <strong style={{ display: "block", marginTop: 4 }}>{test.title}</strong>
                <small className="app-muted">
                  {test.subsystemName} · {test.testDate}
                </small>
              </div>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Delete "${test.title}"?`)) {
                    mutate({ action: "delete-test", testId: test.id });
                  }
                }}
              >
                Delete
              </button>
            </header>
            {test.hypothesis ? (
              <small className="app-muted">
                <strong>Hypothesis:</strong> {test.hypothesis}
              </small>
            ) : null}
            {test.resultSummary ? <p style={{ margin: 0 }}>{test.resultSummary}</p> : null}
            {test.metricLabel && test.metricValue != null ? (
              <small className="app-muted">
                {test.metricLabel}: {test.metricValue}
                {test.metricTarget != null ? ` (target ${test.metricTarget})` : ""}
              </small>
            ) : null}
            <DraftDecisionForm test={test} busy={busy} mutate={mutate} />
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function DraftDecisionForm({
  test,
  busy,
  mutate,
}: {
  test: LiveView["tests"][number];
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const [decisionTitle, setDecisionTitle] = useState(`Decide on ${test.title}`);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!decisionTitle.trim()) return;
        mutate({ action: "draft-decision", testId: test.id, decisionTitle });
      }}
      style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}
    >
      <input
        value={decisionTitle}
        onChange={(event) => setDecisionTitle(event.target.value)}
        placeholder="Decision title"
        style={{ flex: 1, minWidth: 180 }}
      />
      <button type="submit" className="app-button secondary" disabled={busy || !decisionTitle.trim()}>
        Draft decision
      </button>
    </form>
  );
}

function DecisionsList({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.decisions.length === 0) {
    return (
      <EmptyState
        badge="No decisions yet"
        badgeTone="setup"
        title="No decision records drafted yet"
        description="Draft a decision from any logged test above to generate the decision record and notebook entry."
      />
    );
  }
  const testTitleById = new Map(view.tests.map((test) => [test.id, test.title]));
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Decision records</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.decisions.map((decision) => (
          <li key={decision.id} className="app-card soft-panel" style={{ display: "grid", gap: 6 }}>
            <header style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
              <div>
                <span className={`app-badge ${RECOMMENDATION_TONE[decision.recommendation]}`}>
                  {decisionRecommendationLabel(decision.recommendation)}
                </span>
                <strong style={{ display: "block", marginTop: 4 }}>{decision.decisionTitle}</strong>
                <small className="app-muted">
                  {testTitleById.get(decision.testId) ?? "Linked test"} · {STATUS_LABEL[decision.status]} ·
                  confidence {pct(decision.confidence)}
                </small>
              </div>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Delete "${decision.decisionTitle}"?`)) {
                    mutate({ action: "delete-decision", decisionId: decision.id });
                  }
                }}
              >
                Delete
              </button>
            </header>
            <p style={{ margin: 0 }}>{decision.decisionRecord}</p>
            <details>
              <summary className="app-muted">Notebook entry</summary>
              <pre style={{ whiteSpace: "pre-wrap", margin: "8px 0 0" }}>{decision.notebookEntry}</pre>
            </details>
            {decision.status === "draft" ? (
              <div>
                <button
                  type="button"
                  className="app-button secondary"
                  disabled={busy}
                  onClick={() => mutate({ action: "update-decision-status", decisionId: decision.id, status: "finalized" })}
                >
                  Finalize
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function LogTestForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      subsystemName: "",
      title: "",
      hypothesis: "",
      testDate: "",
      outcome: "inconclusive" as TestOutcome,
      resultSummary: "",
      metricLabel: "",
      metricValue: "",
      metricTarget: "",
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
        if (!form.subsystemName.trim() || !form.title.trim() || !form.testDate) return;
        mutate({
          action: "log-test",
          subsystemName: form.subsystemName,
          title: form.title,
          hypothesis: form.hypothesis || undefined,
          testDate: form.testDate,
          outcome: form.outcome,
          resultSummary: form.resultSummary || undefined,
          metricLabel: form.metricLabel || undefined,
          metricValue: form.metricValue === "" ? undefined : Number(form.metricValue),
          metricTarget: form.metricTarget === "" ? undefined : Number(form.metricTarget),
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Log a prototype test</h2>
      <FormGrid min={180}>
        <FormRow label="Subsystem">
          <input value={form.subsystemName} onChange={set("subsystemName")} placeholder="Climber" required />
        </FormRow>
        <FormRow label="Title">
          <input value={form.title} onChange={set("title")} placeholder="Latch v2 load test" required />
        </FormRow>
        <FormRow label="Test date">
          <input type="date" value={form.testDate} onChange={set("testDate")} required />
        </FormRow>
        <FormRow label="Outcome">
          <select value={form.outcome} onChange={set("outcome")}>
            {TEST_OUTCOMES.map((outcome) => (
              <option key={outcome} value={outcome}>
                {testOutcomeLabel(outcome)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Metric label (optional)">
          <input value={form.metricLabel} onChange={set("metricLabel")} placeholder="Hold time (s)" />
        </FormRow>
        <FormRow label="Metric value (optional)">
          <input type="number" value={form.metricValue} onChange={set("metricValue")} />
        </FormRow>
        <FormRow label="Metric target (optional)">
          <input type="number" value={form.metricTarget} onChange={set("metricTarget")} />
        </FormRow>
      </FormGrid>
      <FormRow label="Hypothesis (optional)">
        <textarea value={form.hypothesis} onChange={set("hypothesis")} rows={2} />
      </FormRow>
      <FormRow label="Result summary (optional)">
        <textarea value={form.resultSummary} onChange={set("resultSummary")} rows={2} />
      </FormRow>
      <div>
        <button
          type="submit"
          className="app-button"
          disabled={busy || !form.subsystemName.trim() || !form.title.trim() || !form.testDate}
        >
          Log test
        </button>
      </div>
    </Panel>
  );
}
