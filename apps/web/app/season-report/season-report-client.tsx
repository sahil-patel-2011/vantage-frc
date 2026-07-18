"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { SEASON_REPORT_CATEGORIES, SEASON_REPORT_SENTIMENTS, seasonReportCategoryLabel, seasonReportSentimentLabel } from "../../lib/season-report";
import type { SeasonReportView } from "../../lib/season-report/compute-season-report";
import type { SeasonReportCategory, SeasonReportSentiment } from "../../lib/season-report/types";

function sentimentTone(sentiment: SeasonReportSentiment): string {
  if (sentiment === "positive") return "good";
  if (sentiment === "negative") return "demo";
  return "setup";
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

type LiveView = Extract<SeasonReportView, { status: "live" }>;

export default function SeasonReportClient() {
  const [view, setView] = useState<SeasonReportView | null>(null);
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
    void fetch(`/api/season-report${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as SeasonReportView | { error?: string };
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
        const response = await fetch("/api/season-report", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        });
        const data = (await response.json()) as SeasonReportView | { error?: string };
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
            <a href={orgId ? `/ai?orgId=${encodeURIComponent(orgId)}` : "/ai"}>AI</a>
            {" / Season Report"}
          </>
        }
        title="Season Report"
        description="Log build reliability, results, budget, and outreach notes through the season, then generate a state-of-the-team retrospective grounded in only what you recorded."
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
          title="Could not load Season Report"
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
          <CompletenessPanel view={view} />
          <LogEntryForm busy={busy} mutate={mutate} />
          {view.summary.totalEntries > 0 ? <CategoryBreakdown view={view} /> : null}
          <SnapshotsPanel view={view} busy={busy} mutate={mutate} />
          <RecentEntries view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function CompletenessPanel({ view }: { view: LiveView }) {
  const { summary } = view;
  return (
    <Panel aria-label="Season report coverage">
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <span className={`app-badge ${summary.completeness >= 0.8 ? "good" : summary.completeness >= 0.4 ? "setup" : "demo"}`}>
            {summary.completeness >= 0.8 ? "READY" : summary.completeness >= 0.4 ? "IN PROGRESS" : "GETTING STARTED"}
          </span>
          <h2 style={{ margin: "6px 0 0" }}>Retrospective coverage</h2>
          <small className="app-muted">{summary.totalEntries} entr{summary.totalEntries === 1 ? "y" : "ies"} logged</small>
        </div>
        <strong style={{ fontSize: "2rem" }}>{pct(summary.completeness)}</strong>
      </header>
      <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
        {summary.byCategory.map((row) => (
          <div key={row.category} style={{ display: "grid", gridTemplateColumns: "160px 1fr 48px", gap: 8, alignItems: "center" }}>
            <span className="app-muted">{seasonReportCategoryLabel(row.category)}</span>
            <span className="mini-probability" aria-hidden="true">
              <i style={{ width: `${Math.max(2, Math.min(100, row.entries * 20))}%` }} />
            </span>
            <small className="app-muted" style={{ textAlign: "right" }}>{row.entries}</small>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function CategoryBreakdown({ view }: { view: LiveView }) {
  const { summary } = view;
  return (
    <section
      className="app-card soft-panel"
      style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 20 }}
    >
      <div>
        <h2 style={{ marginTop: 0 }}>By category</h2>
        <ul className="factor-table" style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
          {summary.byCategory.map((row) => (
            <li key={row.category} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span>{seasonReportCategoryLabel(row.category)}</span>
              <small className="app-muted">
                {row.entries} · {row.positive} positive · {row.negative} watch
              </small>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function SnapshotsPanel({
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
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Generated snapshots</h2>
        <button
          type="button"
          className="app-button"
          disabled={busy || view.summary.totalEntries === 0}
          onClick={() => mutate({ action: "generate-snapshot" })}
        >
          Generate retrospective
        </button>
      </header>
      {view.summary.totalEntries === 0 ? (
        <p className="app-muted">Log at least one entry to generate a retrospective snapshot.</p>
      ) : view.snapshots.length === 0 ? (
        <p className="app-muted">No snapshot generated yet for this season.</p>
      ) : (
        <div style={{ display: "grid", gap: 16, marginTop: 12 }}>
          {view.snapshots.map((snapshot) => (
            <article key={snapshot.id} className="app-card soft-panel" style={{ display: "grid", gap: 10 }}>
              <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <small className="app-muted">
                  {new Date(snapshot.createdAt).toLocaleString()} · {snapshot.entryCount} entries · {pct(snapshot.completeness)} coverage
                </small>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => mutate({ action: "delete-snapshot", snapshotId: snapshot.id })}
                >
                  Delete
                </button>
              </header>
              {SEASON_REPORT_CATEGORIES.map((category) => (
                <p key={category} style={{ margin: 0 }}>
                  <strong>{seasonReportCategoryLabel(category)}: </strong>
                  {snapshot.narrative[toNarrativeKey(category)]}
                </p>
              ))}
              {snapshot.highlights.length > 0 ? (
                <div>
                  <strong className="app-muted">Highlights</strong>
                  <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                    {snapshot.highlights.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {snapshot.watchouts.length > 0 ? (
                <div>
                  <strong className="app-muted">Watchouts</strong>
                  <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                    {snapshot.watchouts.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </Panel>
  );
}

function toNarrativeKey(category: SeasonReportCategory): "buildReliability" | "results" | "budget" | "outreach" | "lessons" {
  switch (category) {
    case "build_reliability":
      return "buildReliability";
    case "results":
      return "results";
    case "budget":
      return "budget";
    case "outreach":
      return "outreach";
    default:
      return "lessons";
  }
}

function RecentEntries({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.summary.totalEntries === 0) {
    return (
      <EmptyState
        badge="No entries yet"
        badgeTone="setup"
        title="Log your first season-report entry"
        description="Build reliability notes, results, budget calls, outreach wins, and lessons build the retrospective narrative."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Recent entries</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.entries.slice(0, 20).map((item) => (
          <li key={item.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
            <div>
              <span className={`app-badge ${sentimentTone(item.sentiment)}`} style={{ marginRight: 8 }}>
                {seasonReportSentimentLabel(item.sentiment)}
              </span>
              <strong>{item.title}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                {seasonReportCategoryLabel(item.category)}
                {item.metricLabel && item.metricValue != null ? ` · ${item.metricLabel}: ${item.metricValue}` : ""}
              </small>
              {item.detail ? <small className="app-muted">{item.detail}</small> : null}
            </div>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Delete "${item.title}"?`)) {
                  mutate({ action: "delete-entry", entryId: item.id });
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

function LogEntryForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      title: "",
      category: "build_reliability" as SeasonReportCategory,
      sentiment: "neutral" as SeasonReportSentiment,
      metricLabel: "",
      metricValue: "",
      detail: "",
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
        if (!form.title.trim()) return;
        mutate({
          action: "log-entry",
          title: form.title,
          category: form.category,
          sentiment: form.sentiment,
          metricLabel: form.metricLabel || undefined,
          metricValue: form.metricValue !== "" ? Number(form.metricValue) : undefined,
          detail: form.detail || undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Log entry</h2>
      <FormGrid min={160}>
        <FormRow label="Title">
          <input value={form.title} onChange={set("title")} placeholder="Climber mechanism jammed twice" required />
        </FormRow>
        <FormRow label="Category">
          <select value={form.category} onChange={set("category")}>
            {SEASON_REPORT_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {seasonReportCategoryLabel(category)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Sentiment">
          <select value={form.sentiment} onChange={set("sentiment")}>
            {SEASON_REPORT_SENTIMENTS.map((sentiment) => (
              <option key={sentiment} value={sentiment}>
                {seasonReportSentimentLabel(sentiment)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Metric label (optional)">
          <input value={form.metricLabel} onChange={set("metricLabel")} placeholder="Match failures" />
        </FormRow>
        <FormRow label="Metric value (optional)">
          <input type="number" value={form.metricValue} onChange={set("metricValue")} />
        </FormRow>
      </FormGrid>
      <FormRow label="Notes (optional)">
        <textarea value={form.detail} onChange={set("detail")} rows={2} />
      </FormRow>
      <div>
        <button type="submit" className="app-button" disabled={busy || !form.title.trim()}>
          Log entry
        </button>
      </div>
    </Panel>
  );
}
