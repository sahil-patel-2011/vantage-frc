"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { counterBookFieldLabel } from "../../lib/counter-book";
import type { CounterBookView } from "../../lib/counter-book/compute-counter-book";
import {
  COUNTER_BOOK_RELATED_INCLUDE,
  classifyCounterBookShell,
  counterBookNextActions,
  counterBookRelatedLinks,
  counterBookShellCopy,
  formatCounterBookMetric,
  shouldShowCounterBookSummaryTiles,
  type CounterBookNextAction,
  type CounterBookShellKind,
} from "../../lib/counter-book/counter-book-related";
import type { CounterBookReport } from "../../lib/counter-book/types";
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./counter-book.css";

type LiveView = Extract<CounterBookView, { status: "live" }>;

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function CounterRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = counterBookRelatedLinks(orgId, {
    include: [...COUNTER_BOOK_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related counter-book-related" aria-label="Related competition tools">
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

function CounterNextActionsPanel({ actions }: { actions: CounterBookNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section
      className="app-card soft-panel edc-next-actions counter-book-next-actions"
      aria-label="Next actions"
    >
      <header>
        <h2>Next actions</h2>
        <p className="app-muted">Strategy and Scouting — never DEMO opponent metrics.</p>
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

function CounterShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: CounterBookShellKind;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = counterBookNextActions({ orgId, shell });
  const copy = counterBookShellCopy(shell);
  const competitionHref = hubHref("/competition", "counter-book", orgId);
  const strategyHref = hubHref("/competition", "strategy", orgId);
  const scoutingHref = hubHref("/competition", "scouting", orgId);

  return (
    <main className="module-page counter-book-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Counter-book"}
          </>
        }
        title="Opponent Counter-book"
        description={description}
      >
        <CounterRelatedStrip orgId={orgId} />
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
                ? "No counter-books yet"
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
            <a className="app-button" href="#counter-book-generate">
              Generate a report
            </a>
            <a className="app-button secondary" href={strategyHref}>
              Open Strategy
            </a>
            <a className="app-button secondary" href={scoutingHref}>
              Open Scouting
            </a>
          </>
        ) : null}
      </EmptyState>
      <CounterNextActionsPanel actions={actions} />
    </main>
  );
}

export default function CounterBookClient() {
  const [view, setView] = useState<CounterBookView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    void fetch(`/api/counter-book${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as CounterBookView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setFetchFailed(true);
          return;
        }
        setView(data);
      })
      .catch(() => setFetchFailed(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const orgId = view && "orgId" in view ? view.orgId : null;
  const reportCount = view?.status === "live" ? view.reports.length : 0;

  const shell = classifyCounterBookShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId: view?.status === "live" ? view.orgId : view?.status === "setup_required" ? view.orgId : null,
    reportCount,
  });
  const shellCopy = counterBookShellCopy(shell);
  const nextActions = counterBookNextActions({ orgId, shell, reportCount });
  const relatedLinks = counterBookRelatedLinks(orgId, {
    include: [...COUNTER_BOOK_RELATED_INCLUDE],
  });
  const competitionHref = hubHref("/competition", "counter-book", orgId);
  const strategyHref = hubHref("/competition", "strategy", orgId);
  const scoutingHref = hubHref("/competition", "scouting", orgId);

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/counter-book", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...payload }),
        });
        const data = (await response.json()) as CounterBookView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, busy],
  );

  if (shell === "loading") {
    return <CounterShell description={shellCopy.description} orgId={null} shell="loading" />;
  }

  if (shell === "error") {
    return (
      <CounterShell
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
      <CounterShell
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
      </CounterShell>
    );
  }

  if (view?.status !== "live") {
    return <CounterShell description={shellCopy.description} orgId={orgId} shell="setup" />;
  }

  return (
    <main className="module-page counter-book-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Counter-book"}
          </>
        }
        title="Opponent Counter-book"
        description="One-page counter-strategy per likely playoff opponent — tendencies and failure triggers pulled only from your team's own scouted matches. Never DEMO opponent metrics. Cross-check Strategy and Scouting."
      >
        <div className="counter-book-header-actions">
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

      <CounterNextActionsPanel actions={nextActions} />

      {shouldShowCounterBookSummaryTiles(reportCount) ? (
        <section className="counter-book-stats" aria-label="Counter-book counts">
          <div>
            <strong>{formatCounterBookMetric(reportCount, true)}</strong>
            <span className="app-muted" style={{ display: "block" }}>
              Generated reports
            </span>
          </div>
        </section>
      ) : null}

      {shell === "empty" ? (
        <EmptyState
          soft
          badge="No counter-books yet"
          badgeTone="setup"
          title={shellCopy.title}
          description={shellCopy.description}
        >
          <a className="app-button" href="#counter-book-generate">
            Generate a report
          </a>
          <a className="app-button secondary" href={strategyHref}>
            Open Strategy
          </a>
          <a className="app-button secondary" href={scoutingHref}>
            Open Scouting
          </a>
        </EmptyState>
      ) : null}

      <div className="counter-book-layout">
        <GenerateReportForm busy={busy} mutate={mutate} />
        {shell === "ready" ? <ReportList view={view} busy={busy} mutate={mutate} /> : null}
        <Panel className="counter-book-tip" aria-label="Counter-book tip">
          <span className="eyebrow">Grounding path</span>
          <p className="app-muted" style={{ marginTop: 8 }}>
            Keep <a href={strategyHref}>Strategy</a> picks grounded in scouted metrics, and deepen{" "}
            <a href={scoutingHref}>Scouting</a> samples before generating — never invent DEMO opponent
            tendencies.
          </p>
        </Panel>
      </div>
    </main>
  );
}

function GenerateReportForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const [teamKey, setTeamKey] = useState("");
  const [eventKey, setEventKey] = useState("");

  return (
    <Panel
      id="counter-book-generate"
      as="form"
      className="counter-book-panel"
      onSubmit={(event) => {
        event.preventDefault();
        if (!teamKey.trim()) return;
        mutate({ action: "generate-report", teamKey: teamKey.trim(), eventKey: eventKey.trim() || undefined });
        setTeamKey("");
        setEventKey("");
      }}
    >
      <h2 style={{ margin: 0 }}>Generate counter-book</h2>
      <p className="app-muted" style={{ margin: 0 }}>
        Reports use only your scouted numeric fields for the opponent — never DEMO tendencies.
      </p>
      <FormGrid min={180}>
        <FormRow label="Opponent team key" hint="e.g. frc254">
          <input value={teamKey} onChange={(e) => setTeamKey(e.target.value)} placeholder="frc254" required />
        </FormRow>
        <FormRow label="Event key (optional)" hint="Limit to matches scouted at one event">
          <input value={eventKey} onChange={(e) => setEventKey(e.target.value)} placeholder="2026casj" />
        </FormRow>
      </FormGrid>
      <div>
        <button type="submit" className="app-button" disabled={busy || !teamKey.trim()}>
          Generate
        </button>
      </div>
    </Panel>
  );
}

function ReportList({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.reports.length === 0) {
    return null;
  }
  return (
    <div className="counter-book-reports" style={{ display: "grid", gap: 12 }}>
      {view.reports.map((report) => (
        <ReportCard key={report.id} report={report} busy={busy} mutate={mutate} />
      ))}
    </div>
  );
}

function ReportCard({
  report,
  busy,
  mutate,
}: {
  report: CounterBookReport;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  return (
    <Panel className="counter-book-panel">
      <header className="counter-book-card-header">
        <div>
          <h2 style={{ margin: 0 }}>{report.title}</h2>
          <small className="app-muted">
            {report.matchesScouted} scouted match(es)
            {report.eventKey ? ` · ${report.eventKey}` : ""} · {new Date(report.createdAt).toLocaleDateString()}
          </small>
        </div>
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() => {
            if (window.confirm(`Delete "${report.title}"?`)) {
              mutate({ action: "delete-report", reportId: report.id });
            }
          }}
        >
          Delete
        </button>
      </header>
      <p style={{ marginTop: 8 }}>{report.summary}</p>
      <p>{report.counterPlan}</p>
      {report.tendencies.length > 0 ? (
        <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
          <strong className="app-muted">Tendencies</strong>
          <ul className="factor-table" style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
            {report.tendencies.slice(0, 8).map((t) => (
              <li key={t.field} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span>{counterBookFieldLabel(t.field)}</span>
                <small className="app-muted">
                  avg {t.average} · {t.sampleSize} samples · variability {pct(t.variability)}
                </small>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {report.failureTriggers.length > 0 ? (
        <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
          <strong className="app-muted">Failure triggers</strong>
          <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
            {report.failureTriggers.map((f) => (
              <li key={f.field}>
                <small className="app-muted">{f.detail}</small>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Panel>
  );
}
