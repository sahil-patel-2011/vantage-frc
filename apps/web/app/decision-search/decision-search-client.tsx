"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { MeteredAiCutoffBanner } from "../../components/metered-ai-cutoff-banner";
import { resolveCutoffErrorCode } from "../../components/usage-cutoff-banner";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { DECISION_SEARCH_SOURCE_KINDS, decisionSearchSourceLabel } from "../../lib/decision-search";
import type { DecisionSearchView } from "../../lib/decision-search/compute-decision-search";
import {
  DECISION_SEARCH_RELATED_INCLUDE,
  classifyDecisionSearchShell,
  decisionSearchNextActions,
  decisionSearchRelatedLinks,
  decisionSearchShellCopy,
  formatDecisionSearchMatchPct,
  formatDecisionSearchMetric,
  type DecisionSearchNextAction,
  type DecisionSearchShellKind,
} from "../../lib/decision-search/decision-search-related";
import type { DecisionSearchSourceKind } from "../../lib/decision-search/types";
import { hubWorkbenchHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./decision-search.css";

type LiveView = Extract<DecisionSearchView, { status: "live" }>;

function DecisionSearchRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = decisionSearchRelatedLinks(orgId, { include: [...DECISION_SEARCH_RELATED_INCLUDE] });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related decision-search-related" aria-label="Related decision tools">
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

function DecisionSearchNextActionsPanel({ actions }: { actions: DecisionSearchNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section
      className="app-card soft-panel edc-next-actions decision-search-next-actions"
      aria-label="Next actions"
    >
      <header>
        <h2>Next actions</h2>
        <p className="app-muted">Each one opens the page where you finish the work.</p>
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

function DecisionSearchShell({
  title,
  description,
  orgId,
  shell,
  documentCount,
  queryCount,
  error,
  onRetry,
  children,
}: {
  title: string;
  description: string;
  orgId?: string | null;
  shell: DecisionSearchShellKind;
  documentCount?: number;
  queryCount?: number;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = decisionSearchNextActions({
    orgId,
    shell,
    documentCount,
    queryCount,
  });
  const workspaceHref = orgId ? withOrgHref("/workspace", orgId) : "/workspace";
  const aiHref = hubWorkbenchHref("ai", "decision-search", orgId);

  return (
    <main className="module-page decision-search-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={aiHref}>AI</a>
            {" / Decision Search"}
          </>
        }
        title="Decision Search"
        description={description}
      >
        <DecisionSearchRelatedStrip orgId={orgId} />
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
                ? "No documents indexed"
                : shell === "loading"
                  ? undefined
                  : "Decision Search"
        }
        badgeTone={shell === "error" ? "demo" : "setup"}
        title={title}
        description={description}
        aria-busy={shell === "loading" || undefined}
      >
        {shell === "error" && onRetry ? (
          <button type="button" className="app-button secondary" onClick={onRetry}>
            Retry
          </button>
        ) : null}
        {shell === "setup" ? (
          <a className="app-button is-primary" href={workspaceHref}>Choose your team</a>
        ) : null}
      </EmptyState>
      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}
      <DecisionSearchNextActionsPanel actions={actions} />
    </main>
  );
}

export default function DecisionSearchClient() {
  const [view, setView] = useState<DecisionSearchView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);
  const [cutoffCode, setCutoffCode] = useState<string | null>(null);

  const orgId = view && "orgId" in view ? view.orgId : null;
  const loading = view == null && !fetchFailed;

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
      if (payload.action === "search") setCutoffCode(null);
      try {
        const response = await fetch("/api/decision-search", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        });
        const data = (await response.json()) as
          | DecisionSearchView
          | { error?: string; code?: string; reason?: string };
        if (!response.ok || !("status" in data)) {
          const cutoff = resolveCutoffErrorCode(response.status, {
            code: "code" in data ? data.code : undefined,
            reason: "reason" in data ? data.reason : undefined,
            error: "error" in data ? data.error : undefined,
          });
          if (cutoff) {
            setCutoffCode(cutoff);
            setError("");
          } else {
            setError("error" in data && data.error ? data.error : "Something went wrong.");
          }
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

  const documentCount = view?.status === "live" ? view.documents.length : 0;
  const queryCount = view?.status === "live" ? view.recentQueries.length : 0;
  const shell = classifyDecisionSearchShell({
    loading,
    fetchFailed,
    status: view?.status ?? null,
    orgId,
    documentCount,
  });
  const shellCopy = decisionSearchShellCopy(shell);
  const nextActions = decisionSearchNextActions({
    orgId,
    shell,
    documentCount,
    queryCount,
  });
  const aiHref = hubWorkbenchHref("ai", "decision-search", orgId);
  const relatedLinks = decisionSearchRelatedLinks(orgId, {
    include: [...DECISION_SEARCH_RELATED_INCLUDE],
  });

  if (shell === "loading") {
    return (
      <DecisionSearchShell
        title={shellCopy.title}
        description={shellCopy.description}
        orgId={orgId}
        shell="loading"
      />
    );
  }

  if (shell === "error") {
    return (
      <DecisionSearchShell
        title={shellCopy.title}
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error}
        onRetry={() => load()}
      />
    );
  }

  if (shell === "setup" && view?.status === "setup_required") {
    return (
      <DecisionSearchShell
        title={view.message}
        description={shellCopy.description}
        orgId={view.orgId}
        shell="setup"
      >
        <ol className="strategy-setup-steps">
          {view.steps.map((step) => (
            <li key={step.id}>
              <div>
                <strong>{step.label}</strong>
                <span>{step.detail}</span>
              </div>
              <a href={step.href.startsWith("/") ? withOrgHref(step.href, view.orgId) : step.href}>
                Open
              </a>
            </li>
          ))}
        </ol>
      </DecisionSearchShell>
    );
  }

  if (shell === "setup") {
    return (
      <DecisionSearchShell
        title={shellCopy.title}
        description={shellCopy.description}
        orgId={orgId}
        shell="setup"
      />
    );
  }

  if (view?.status !== "live") {
    return (
      <DecisionSearchShell
        title={shellCopy.title}
        description={shellCopy.description}
        orgId={orgId}
        shell="setup"
      />
    );
  }

  return (
    <main className="module-page decision-search-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={aiHref}>AI</a>
            {" / Decision Search"}
          </>
        }
        title="Decision Search"
        description="Semantic search over decisions, design reviews, and notebook entries you indexed — grounded only in real text."
      >
        <div className="decision-search-header-actions">
          {relatedLinks.map((link) => (
            <a key={link.id} className="app-button secondary" href={link.href}>
              {link.label}
            </a>
          ))}
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
        </div>
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {orgId ? (
        <MeteredAiCutoffBanner
          orgId={orgId}
          errorCode={cutoffCode}
          compact
          className="decision-search-metered"
        />
      ) : null}

      <DecisionSearchNextActionsPanel actions={nextActions} />

      {shell === "empty" ? (
        <EmptyState
          soft
          badge="No documents indexed"
          badgeTone="setup"
          title={shellCopy.title}
          description={shellCopy.description}
        >
          <a className="app-button" href="#decision-search-index">
            Index first record
          </a>
        </EmptyState>
      ) : null}

      <div style={{ display: "grid", gap: 16 }}>
        <IndexStatsPanel view={view} loaded />
        <SearchForm busy={busy} mutate={mutate} documentCount={documentCount} />
        <ResultsPanel view={view} loaded />
        <IndexDocumentForm busy={busy} mutate={mutate} orgId={orgId} />
        <DocumentsList view={view} busy={busy} mutate={mutate} />
      </div>
    </main>
  );
}

function IndexStatsPanel({ view, loaded }: { view: LiveView; loaded: boolean }) {
  const docLabel = formatDecisionSearchMetric(view.documents.length, loaded);
  const queryLabel = formatDecisionSearchMetric(view.recentQueries.length, loaded);
  return (
    <Panel className="decision-search-coverage" aria-label="Decision Search index">
      <div className="decision-search-stats">
        <div>
          <span
            className={`app-badge ${view.documents.length === 0 ? "setup" : "good"}`}
          >
            {view.documents.length === 0 ? "EMPTY" : "INDEXED"}
          </span>
          <h2 style={{ margin: "6px 0 0" }}>Search corpus</h2>
          <small className="app-muted">
            Real indexed documents only.
          </small>
        </div>
        <div>
          <strong>{docLabel}</strong>
          <small className="app-muted" style={{ display: "block" }}>
            document{view.documents.length === 1 ? "" : "s"}
          </small>
        </div>
        <div>
          <strong>{queryLabel}</strong>
          <small className="app-muted" style={{ display: "block" }}>
            recent quer{view.recentQueries.length === 1 ? "y" : "ies"}
          </small>
        </div>
      </div>
    </Panel>
  );
}

function SearchForm({
  busy,
  mutate,
  documentCount,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
  documentCount: number;
}) {
  const [queryText, setQueryText] = useState("");
  return (
    <Panel
      id="decision-search-query"
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!queryText.trim()) return;
        mutate({ action: "search", queryText });
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Search</h2>
      <p className="app-muted decision-search-query-hint">
        {documentCount === 0
          ? "Index at least one document below before searching — empty corpora return no matches."
          : "Matches use term overlap on title, tags, and body. Only indexed text ranks."}
      </p>
      <FormRow label="What are you looking for?">
        <input
          value={queryText}
          onChange={(event) => setQueryText(event.target.value)}
          placeholder="e.g. climber reliability, gear ratio tradeoffs"
          disabled={busy}
          aria-describedby="decision-search-query-hint"
        />
      </FormRow>
      <p id="decision-search-query-hint" className="app-muted" style={{ margin: 0, fontSize: "0.9rem" }}>
        Tip: use concrete nouns from your decisions (subsystem, failure mode, tradeoff). Vague words rarely match.
      </p>
      <div>
        <button type="submit" className="app-button" disabled={busy || !queryText.trim()}>
          Search
        </button>
      </div>
    </Panel>
  );
}

function ResultsPanel({ view, loaded }: { view: LiveView; loaded: boolean }) {
  const lastQuery = view.recentQueries[0];
  if (!lastQuery) {
    return (
      <EmptyState
        soft
        badge="No searches yet"
        badgeTone="setup"
        title="Run your first search"
        description={
          view.documents.length === 0
            ? "Index a decision, design review, or notebook entry below, then search over it."
            : "Ask about a tradeoff or reliability note. Results appear only when query terms overlap indexed text."
        }
      >
        <a className="app-button secondary" href="#decision-search-query">
          Focus search
        </a>
      </EmptyState>
    );
  }
  return (
    <Panel aria-label="Search results">
      <h2 style={{ marginTop: 0 }}>Results for &ldquo;{lastQuery.queryText}&rdquo;</h2>
      {lastQuery.resultSummary ? <p className="app-muted">{lastQuery.resultSummary}</p> : null}
      {view.recentQueries.length > 1 ? (
        <div className="decision-search-recent" aria-label="Recent queries">
          {view.recentQueries.slice(1, 6).map((q) => (
            <span key={q.id} className="app-badge setup">
              {q.queryText.slice(0, 40)}
              {q.queryText.length > 40 ? "…" : ""}
            </span>
          ))}
        </div>
      ) : null}
      {view.lastMatches.length === 0 ? (
        <EmptyState
          soft
          title="No matches"
          description="No indexed documents matched this query. Try different terms, or index more real decisions."
        />
      ) : (
        <ul className="decision-search-match-list">
          {view.lastMatches.map((match) => (
            <li key={match.document.id}>
              <div className="decision-search-match-head">
                <strong>{match.document.title}</strong>
                <small className="app-muted">
                  {formatDecisionSearchMatchPct(match.score, loaded)} match
                </small>
              </div>
              <small className="app-muted">
                {decisionSearchSourceLabel(match.document.sourceKind)}
                {match.document.tags.length ? ` · ${match.document.tags.join(", ")}` : ""}
              </small>
              {match.matchedTerms.length > 0 ? (
                <div className="decision-search-terms" aria-label="Matched terms">
                  {match.matchedTerms.map((term) => (
                    <span key={term} className="app-badge good">
                      {term}
                    </span>
                  ))}
                </div>
              ) : null}
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
    return null;
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Indexed documents</h2>
      <p className="app-muted" style={{ marginTop: 0 }}>
        {formatDecisionSearchMetric(view.documents.length, true)} real record
        {view.documents.length === 1 ? "" : "s"} in this season — remove only if you meant to unindex.
      </p>
      <ul className="decision-search-doc-list">
        {view.documents.slice(0, 30).map((doc) => (
          <li key={doc.id}>
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
  orgId,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
  orgId?: string | null;
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
  const decisionsHref = withOrgHref("/decisions", orgId);

  return (
    <Panel
      id="decision-search-index"
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
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <a className="app-button secondary" href={decisionsHref}>
            Open Decision Log
          </a>
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
      </div>
      <p className="app-muted" style={{ margin: 0 }}>
        Paste real decision text only. Import uses Decision Log context/decision/rationale.
      </p>
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
