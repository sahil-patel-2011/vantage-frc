"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { decisionSearchSourceLabel } from "../../lib/decision-search";
import {
  DECISION_SEARCH_SOURCE_KINDS,
  type DecisionSearchView,
} from "../../lib/decision-search/compute-decision-search";
import type { DecisionSearchSourceKind } from "../../lib/decision-search/types";

type LiveView = Extract<DecisionSearchView, { status: "live" }>;

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export default function DecisionSearchClient() {
  const [view, setView] = useState<DecisionSearchView | null>(null);
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
    void fetch(`/api/decision-search${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as DecisionSearchView | { error?: string };
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
        const response = await fetch("/api/decision-search", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        });
        const data = (await response.json()) as DecisionSearchView | { error?: string };
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
            {" / Decision Search"}
          </>
        }
        title="Decision Search"
        description="Semantic search over your team's decisions, design reviews, and notebook entries — grounded only in what you've indexed."
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
          title="Could not load Decision Search"
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
          <SearchForm busy={busy} mutate={mutate} />
          <ResultsPanel view={view} />
          <IndexDocumentForm busy={busy} mutate={mutate} />
          <DocumentsList view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function SearchForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const [queryText, setQueryText] = useState("");
  return (
    <Panel
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!queryText.trim()) return;
        mutate({ action: "search", queryText });
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Search</h2>
      <FormRow label="What are you looking for?">
        <input
          value={queryText}
          onChange={(event) => setQueryText(event.target.value)}
          placeholder="e.g. climber reliability, gear ratio tradeoffs"
        />
      </FormRow>
      <div>
        <button type="submit" className="app-button" disabled={busy || !queryText.trim()}>
          Search
        </button>
      </div>
    </Panel>
  );
}

function ResultsPanel({ view }: { view: LiveView }) {
  const lastQuery = view.recentQueries[0];
  if (!lastQuery) {
    return (
      <EmptyState
        badge="No searches yet"
        badgeTone="setup"
        title="Run your first search"
        description="Index a decision, design review, or notebook entry below, then search over it."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Results for &ldquo;{lastQuery.queryText}&rdquo;</h2>
      {lastQuery.resultSummary ? <p className="app-muted">{lastQuery.resultSummary}</p> : null}
      {view.lastMatches.length === 0 ? (
        <EmptyState title="No matches" description="No indexed documents matched this query." />
      ) : (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
          {view.lastMatches.map((match) => (
            <li key={match.document.id} style={{ display: "grid", gap: 4 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <strong>{match.document.title}</strong>
                <small className="app-muted">{pct(match.score)} match</small>
              </div>
              <small className="app-muted">
                {decisionSearchSourceLabel(match.document.sourceKind)}
                {match.document.tags.length ? ` · ${match.document.tags.join(", ")}` : ""}
              </small>
              <p style={{ margin: 0 }}>{match.document.body.slice(0, 240)}</p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function DocumentsList({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.documents.length === 0) {
    return (
      <EmptyState
        badge="No documents indexed"
        badgeTone="setup"
        title="Index your first record"
        description="Decisions, design reviews, and notebook entries you index become searchable here."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Indexed documents</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.documents.slice(0, 30).map((doc) => (
          <li key={doc.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
            <div>
              <strong>{doc.title}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                {decisionSearchSourceLabel(doc.sourceKind)}
                {doc.tags.length ? ` · ${doc.tags.join(", ")}` : ""}
              </small>
            </div>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Remove "${doc.title}" from the search index?`)) {
                  mutate({ action: "delete-document", documentId: doc.id });
                }
              }}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function IndexDocumentForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      sourceId: "",
      title: "",
      body: "",
      sourceKind: "notebook_entry" as DecisionSearchSourceKind,
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
        if (!form.title.trim() || !form.body.trim() || !form.sourceId.trim()) return;
        mutate({
          action: "index-document",
          sourceId: form.sourceId,
          title: form.title,
          body: form.body,
          sourceKind: form.sourceKind,
          tags: form.tags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>Index a record</h2>
        <button
          type="button"
          className="app-button secondary"
          disabled={busy}
          onClick={() => mutate({ action: "import-decisions" })}
          title="Pull this season's Decision Log entries into the search index"
        >
          Import from Decision Log
        </button>
      </div>
      <FormGrid min={160}>
        <FormRow label="Source ID">
          <input value={form.sourceId} onChange={set("sourceId")} placeholder="e.g. decision-42" required />
        </FormRow>
        <FormRow label="Type">
          <select value={form.sourceKind} onChange={set("sourceKind")}>
            {DECISION_SEARCH_SOURCE_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {decisionSearchSourceLabel(kind)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Title">
          <input value={form.title} onChange={set("title")} placeholder="Switch to telescoping climber" required />
        </FormRow>
        <FormRow label="Tags (comma-separated, optional)">
          <input value={form.tags} onChange={set("tags")} placeholder="climber, endgame" />
        </FormRow>
      </FormGrid>
      <FormRow label="Body">
        <textarea value={form.body} onChange={set("body")} rows={3} required />
      </FormRow>
      <div>
        <button
          type="submit"
          className="app-button"
          disabled={busy || !form.title.trim() || !form.body.trim() || !form.sourceId.trim()}
        >
          Index
        </button>
      </div>
    </Panel>
  );
}
