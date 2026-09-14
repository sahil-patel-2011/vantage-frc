"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MeteredAiCutoffBanner } from "../../components/metered-ai-cutoff-banner";
import { OfflineBanner } from "../../components/offline-banner";
import { resolveCutoffErrorCode } from "../../components/usage-cutoff-banner";
import { AIAttribution, EmptyState, FormGrid, FormRow, PageHeader, Panel, Button } from "../../components/ui";
import {
  AI_EXPAND_IDLE,
  expandedDisplay,
  expandFailureState,
  expandSuccessState,
  type AiExpandState,
} from "../../lib/ai-expand";
import { hubWorkbenchHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { withOrgHref } from "../../lib/nav/product-nav";
import {
  SEASON_REPORT_CATEGORIES,
  SEASON_REPORT_SENTIMENTS,
  seasonReportCategoryLabel,
  seasonReportSentimentLabel,
} from "../../lib/season-report";
import type { SeasonReportView } from "../../lib/season-report/compute-season-report";
import {
  SEASON_REPORT_RELATED_INCLUDE,
  classifySeasonReportShell,
  formatSeasonReportCompleteness,
  formatSeasonReportMetric,
  seasonReportNextActions,
  seasonReportRelatedLinks,
  seasonReportShellCopy,
  type SeasonReportNextAction,
  type SeasonReportShellKind,
} from "../../lib/season-report/season-report-related";
import type { SeasonReportCategory, SeasonReportSentiment } from "../../lib/season-report/types";
import "./season-report.css";

function sentimentTone(sentiment: SeasonReportSentiment): string {
  if (sentiment === "positive") return "good";
  if (sentiment === "negative") return "demo";
  return "setup";
}

function isSeasonReportView(value: unknown): value is SeasonReportView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

function seasonReportCacheOrg(data: SeasonReportView, orgHint: string): string {
  if (typeof data.orgId === "string" && data.orgId.trim()) return data.orgId;
  return orgHint;
}

async function persistSeasonReportSnapshot(
  orgHint: string,
  seasonHint: string,
  data: SeasonReportView,
): Promise<void> {
  const cacheOrg = seasonReportCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  const seasonKey = String(data.seasonYear);
  try {
    await putFeatureSnapshot("season-report", cacheOrg, data, seasonHint || seasonKey);
    if (!orgHint) await putFeatureSnapshot("season-report", "_", data, seasonHint || seasonKey);
  } catch {
    // Live Season report already painted; IndexedDB is best-effort.
  }
}

type LiveView = Extract<SeasonReportView, { status: "live" }>;

function SeasonReportRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = seasonReportRelatedLinks(orgId, { include: [...SEASON_REPORT_RELATED_INCLUDE] });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related season-report-related" aria-label="Related season tools">
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}

function SeasonReportNextActionsPanel({ actions }: { actions: SeasonReportNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section
      className="app-card soft-panel edc-next-actions season-report-next-actions"
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
            <Button as="a" variant="secondary" href={action.href}>
              Open
            </Button>
          </li>
        ))}
      </ol>
    </section>
  );
}

function SeasonReportShell({
  title,
  description,
  orgId,
  shell,
  entryCount,
  snapshotCount,
  error,
  onRetry,
  children,
}: {
  title: string;
  description: string;
  orgId?: string | null;
  shell: SeasonReportShellKind;
  entryCount?: number;
  snapshotCount?: number;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = seasonReportNextActions({
    orgId,
    shell,
    entryCount,
    snapshotCount,
  });
  const workspaceHref = orgId ? withOrgHref("/workspace", orgId) : "/workspace";
  const aiHref = hubWorkbenchHref("ai", "season-report", orgId);

  return (
    <main className="module-page season-report-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={aiHref}>AI</a>
            {" / Season report"}
          </>
        }
        title="Season report"
        description={description}
      >
        <SeasonReportRelatedStrip orgId={orgId} />
      </PageHeader>
      {children}
      <EmptyState
        soft
        badge={
          shell === "setup"
            ? "Needs setup"
            : shell === "error"
              ? "Unavailable"
              : shell === "empty"
                ? "No entries yet"
                : shell === "loading"
                  ? undefined
                  : "Season report"
        }
        badgeTone={shell === "error" ? "demo" : "setup"}
        title={title}
        description={description}
        aria-busy={shell === "loading" || undefined}
      >
        {shell === "error" && onRetry ? (
          <Button variant="secondary" type="button" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
        {shell === "setup" ? (
          <Button as="a" variant="primary" href={workspaceHref}>Choose your team</Button>
        ) : null}
      </EmptyState>
      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}
      {shell === "ready" ? <SeasonReportNextActionsPanel actions={actions} /> : null}
    </main>
  );
}

export default function SeasonReportClient() {
  const [view, setView] = useState<SeasonReportView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);
  const [cutoffCode, setCutoffCode] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<SeasonReportView | null>(null);
  viewRef.current = view;

  const orgId = view && "orgId" in view ? view.orgId : null;
  const loading = view == null && !fetchFailed;

  const load = useCallback((seasonOverride?: number) => {
    void (async () => {
      const params = new URLSearchParams(window.location.search);
      const urlOrg = params.get("orgId")?.trim() ?? "";
      const seasonQuery =
        seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
      const seasonHint =
        seasonQuery != null && Number.isFinite(seasonQuery) ? String(seasonQuery) : "";
      let hadCache = Boolean(viewRef.current);
      try {
        const cached = await getFeatureSnapshot<SeasonReportView>(
          "season-report",
          urlOrg || "_",
          seasonHint,
        );
        if (!viewRef.current && cached?.data && isSeasonReportView(cached.data)) {
          setView(cached.data);
          setSeason(cached.data.seasonYear);
          setFromCache(true);
          setCachedAt(cached.cachedAt);
          hadCache = true;
        }
      } catch {
        // IndexedDB missing or blocked; live fetch still runs.
      }
      setFetchFailed(false);
      setError("");
      const query = new URLSearchParams();
      if (urlOrg) query.set("orgId", urlOrg);
      if (seasonHint) query.set("season", seasonHint);
      try {
        const response = await fetch(
          `/api/season-report${query.toString() ? `?${query.toString()}` : ""}`,
          {
            cache: "no-store",
            signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
          },
        );
        const data = (await response.json()) as SeasonReportView | { error?: string };
        if (!response.ok || !isSeasonReportView(data)) {
          if (hadCache || viewRef.current) {
            setFromCache(true);
            setError("Could not refresh Season report. Showing the last copy on this device.");
            setFetchFailed(false);
          } else {
            setFetchFailed(true);
          }
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
        setFromCache(false);
        setCachedAt(null);
        await persistSeasonReportSnapshot(urlOrg, seasonHint, data);
      } catch {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Season report. Showing the last copy on this device.");
          setFetchFailed(false);
        } else {
          setFetchFailed(true);
        }
      }
    })();
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      if (payload.action === "generate-snapshot") setCutoffCode(null);
      try {
        const response = await fetch("/api/season-report", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data = (await response.json()) as
          | SeasonReportView
          | { error?: string; code?: string; reason?: string };
        if (!response.ok || !isSeasonReportView(data)) {
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
        void persistSeasonReportSnapshot(orgId, season != null ? String(season) : "", data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, season, busy],
  );

  const entryCount = view?.status === "live" ? view.summary.totalEntries : 0;
  const snapshotCount = view?.status === "live" ? view.snapshots.length : 0;
  const shell = classifySeasonReportShell({
    loading,
    fetchFailed,
    status: view?.status ?? null,
    orgId,
    entryCount,
  });
  const shellCopy = seasonReportShellCopy(shell);
  const nextActions = seasonReportNextActions({
    orgId,
    shell,
    entryCount,
    snapshotCount,
  });
  const aiHref = hubWorkbenchHref("ai", "season-report", orgId);
  const relatedLinks = seasonReportRelatedLinks(orgId, {
    include: [...SEASON_REPORT_RELATED_INCLUDE],
  });

  if (shell === "loading") {
    return (
      <SeasonReportShell
        title={shellCopy.title}
        description={shellCopy.description}
        orgId={orgId}
        shell="loading"
      >
        <OfflineBanner feature="Season report" fromCache={fromCache} cachedAt={cachedAt} />
      </SeasonReportShell>
    );
  }

  if (shell === "error") {
    return (
      <SeasonReportShell
        title={shellCopy.title}
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error}
        onRetry={() => load()}
      >
        <OfflineBanner feature="Season report" fromCache={fromCache} cachedAt={cachedAt} />
      </SeasonReportShell>
    );
  }

  if (shell === "setup" && view?.status === "setup_required") {
    return (
      <SeasonReportShell
        title={view.message}
        description={shellCopy.description}
        orgId={view.orgId}
        shell="setup"
      >
        <OfflineBanner feature="Season report" fromCache={fromCache} cachedAt={cachedAt} />
      </SeasonReportShell>
    );
  }

  if (shell === "setup") {
    return (
      <SeasonReportShell
        title={shellCopy.title}
        description={shellCopy.description}
        orgId={orgId}
        shell="setup"
      >
        <OfflineBanner feature="Season report" fromCache={fromCache} cachedAt={cachedAt} />
      </SeasonReportShell>
    );
  }

  if (view?.status !== "live") {
    return (
      <SeasonReportShell
        title={shellCopy.title}
        description={shellCopy.description}
        orgId={orgId}
        shell="setup"
      >
        <OfflineBanner feature="Season report" fromCache={fromCache} cachedAt={cachedAt} />
      </SeasonReportShell>
    );
  }

  return (
    <main className="module-page season-report-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={aiHref}>AI</a>
            {" / Season report"}
          </>
        }
        title="Season report"
        description="Log build reliability, results, budget, and outreach notes through the season, then generate a state-of-the-team retrospective grounded in only what you recorded."
      >
        <div className="season-report-header-actions">
          {relatedLinks.map((link) => (
            <Button as="a" variant="secondary" key={link.id} href={link.href}>
              {link.label}
            </Button>
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
      <OfflineBanner feature="Season report" fromCache={fromCache} cachedAt={cachedAt} />

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
          className="season-report-metered"
        />
      ) : null}

      <SeasonReportNextActionsPanel actions={nextActions} />

      {shell === "empty" ? (
        <EmptyState
          soft
          badge="No entries yet"
          badgeTone="setup"
          title={shellCopy.title}
          description={shellCopy.description}
        >
          <Button as="a" variant="primary" href="#season-report-log">
            Log first entry
          </Button>
        </EmptyState>
      ) : null}

      <div style={{ display: "grid", gap: 16 }}>
        <CompletenessPanel view={view} loaded />
        <LogEntryForm busy={busy} mutate={mutate} />
        {view.summary.totalEntries > 0 ? <CategoryBreakdown view={view} /> : null}
        <SnapshotsPanel view={view} busy={busy} mutate={mutate} />
        <RecentEntries view={view} busy={busy} mutate={mutate} />
      </div>
    </main>
  );
}

function CompletenessPanel({ view, loaded }: { view: LiveView; loaded: boolean }) {
  const { summary } = view;
  const completenessLabel = formatSeasonReportCompleteness(summary.completeness, loaded);
  const entryLabel = formatSeasonReportMetric(summary.totalEntries, loaded);
  return (
    <Panel className="season-report-coverage" aria-label="Season report coverage">
      <header>
        <div>
          <span
            className={`app-badge ${
              summary.completeness >= 0.8 ? "good" : summary.completeness >= 0.4 ? "setup" : "demo"
            }`}
          >
            {summary.totalEntries === 0
              ? "EMPTY"
              : summary.completeness >= 0.8
                ? "READY"
                : summary.completeness >= 0.4
                  ? "IN PROGRESS"
                  : "GETTING STARTED"}
          </span>
          <h2 style={{ margin: "6px 0 0" }}>Retrospective coverage</h2>
          <small className="app-muted">
            {entryLabel} entr{summary.totalEntries === 1 ? "y" : "ies"} logged.
          </small>
        </div>
        <strong className="season-report-coverage-pct">{completenessLabel}</strong>
      </header>
      <div className="season-report-bars">
        {summary.byCategory.map((row) => (
          <div key={row.category} className="season-report-bar-row">
            <span className="app-muted">{seasonReportCategoryLabel(row.category)}</span>
            <span className="mini-probability" aria-hidden="true">
              <i style={{ width: `${Math.max(2, Math.min(100, row.entries * 20))}%` }} />
            </span>
            <small className="app-muted" style={{ textAlign: "right" }}>
              {formatSeasonReportMetric(row.entries, loaded)}
            </small>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function CategoryBreakdown({ view }: { view: LiveView }) {
  const { summary } = view;
  return (
    <section className="app-card soft-panel season-report-breakdown">
      <div>
        <h2 style={{ marginTop: 0 }}>By category</h2>
        <ul className="season-report-list">
          {summary.byCategory.map((row) => (
            <li key={row.category}>
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
  // Optional metered AI expansion of the computed retrospective. The computed
  // snapshot always renders; a missing model degrades to it with a setup note.
  const [expand, setExpand] = useState<AiExpandState>(AI_EXPAND_IDLE);

  const expandWithAi = async () => {
    setExpand({ status: "loading" });
    try {
      const response = await fetch("/api/season-report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId: view.orgId, seasonYear: view.seasonYear, action: "expand-narrative" }),
      });
      const data = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        setExpand(
          expandFailureState({
            httpStatus: response.status,
            code: typeof data.code === "string" ? data.code : null,
            error: typeof data.error === "string" ? data.error : null,
          }),
        );
        return;
      }
      setExpand(expandSuccessState(data));
    } catch {
      setExpand(expandFailureState({ httpStatus: 0, error: "network error" }));
    }
  };

  const aiDisplay = expandedDisplay("", expand);

  return (
    <Panel id="season-report-snapshots">
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Generated snapshots</h2>
        <Button variant="primary" type="button" disabled={busy || view.summary.totalEntries === 0} onClick={() => mutate({ action: "generate-snapshot" })}>
          Generate retrospective
        </Button>
      </header>
      <p className="app-muted">
        Snapshots are computed deterministically from your logged entries.
        &ldquo;Expand with AI&rdquo; is the optional metered model pass on top.
      </p>
      {view.summary.totalEntries === 0 ? (
        <p className="app-muted">Log at least one entry to generate a retrospective snapshot.</p>
      ) : view.snapshots.length === 0 ? (
        <p className="app-muted">No snapshot generated yet for this season.</p>
      ) : (
        <div className="season-report-snapshots">
          {view.snapshots.map((snapshot) => (
            <article key={snapshot.id} className="app-card soft-panel" style={{ display: "grid", gap: 10 }}>
              <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <small className="app-muted">
                  {new Date(snapshot.createdAt).toLocaleString()} · {snapshot.entryCount} entries ·{" "}
                  {formatSeasonReportCompleteness(snapshot.completeness, true)} coverage
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
              <AIAttribution kind="computed" feature="season_report" generatedAt={snapshot.createdAt} />
            </article>
          ))}
          {expand.status === "ready" && aiDisplay.aiText ? (
            <article className="app-card soft-panel" style={{ display: "grid", gap: 10 }}>
              <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{aiDisplay.aiText}</p>
              <AIAttribution
                kind="ai"
                feature="season_report"
                generatedAt={expand.expansion.generatedAt}
                onRegenerate={() => void expandWithAi()}
              />
            </article>
          ) : (
            <div style={{ display: "grid", gap: 6, justifyItems: "start" }}>
              <Button variant="secondary" type="button" style={{ minHeight: 44 }} disabled={busy || expand.status === "loading"} onClick={() => void expandWithAi()}>
                {expand.status === "loading" ? "Expanding…" : "Expand with AI"}
              </Button>
              {aiDisplay.note ? <p className="app-muted" style={{ margin: 0 }}>{aiDisplay.note}</p> : null}
            </div>
          )}
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
    return null;
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Recent entries</h2>
      <ul className="season-report-entry-list">
        {view.entries.slice(0, 20).map((item) => (
          <li key={item.id}>
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
      id="season-report-log"
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
        <Button variant="primary" type="submit" disabled={busy || !form.title.trim()}>
          Log entry
        </Button>
      </div>
    </Panel>
  );
}
