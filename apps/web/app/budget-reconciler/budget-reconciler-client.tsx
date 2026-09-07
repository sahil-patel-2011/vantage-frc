"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, PageHeader, Panel } from "../../components/ui";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { budgetStatusLabel } from "../../lib/budget-reconciler";
import type { BudgetReconcilerView } from "../../lib/budget-reconciler/compute-budget-reconciler";
import type { BudgetStatus } from "../../lib/budget-reconciler/types";
import { renderReceiptFrom, type RenderReceipt } from "../../lib/ai-render/outcome";
import { RenderAttribution } from "../../components/ui/render-attribution";

const STATUS_TONE: Record<BudgetStatus, string> = {
  over: "setup",
  under: "good",
  on_target: "good",
};

function pct(value: number): string {
  return `${value >= 0 ? "+" : ""}${Math.round(value * 100)}%`;
}

type LiveView = Extract<BudgetReconcilerView, { status: "live" }>;

export default function BudgetReconcilerClient() {
  const [view, setView] = useState<BudgetReconcilerView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [loadStatus, setLoadStatus] = useState<number | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  // Honest badge for the latest reconciliation render: "AI" only when a model wrote it.
  const [renderReceipt, setRenderReceipt] = useState<RenderReceipt | null>(null);
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
    void fetch(`/api/budget-reconciler${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as BudgetReconcilerView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setLoadStatus(response.status);
          setLoadError("error" in data && data.error ? data.error : "");
          setFetchFailed(true);
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
      })
      .catch(() => {
        setLoadStatus(null);
        setLoadError("");
        setFetchFailed(true);
      });
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
        const response = await fetch("/api/budget-reconciler", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        });
        const data = (await response.json()) as BudgetReconcilerView | { error?: string };
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
            <a href={orgId ? `/build?orgId=${encodeURIComponent(orgId)}` : "/build"}>Build</a>
            {" / Budget Reconciler"}
          </>
        }
        title="Budget Reconciler"
        description="Watches the as-designed weight and power budgets, flags drift past target, and proposes which subsystem to trim."
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

      <RenderAttribution receipt={renderReceipt} feature="budget_reconciler" />

      {fetchFailed ? (
        (() => {
          const kind = classifyLoadFailure({
            status: loadStatus,
            message: loadError,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          });
          const copy = loadFailureCopy(kind, {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message: loadError || "A network or server issue prevented loading. Try again.",
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
                <a href={step.href} aria-label={`Open ${step.label}`}>Open</a>
              </li>
            ))}
          </ol>
        </EmptyState>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <BudgetTiles view={view} />
          <RunPanel view={view} busy={busy} mutate={mutate} />
          {view.subsystems.length > 0 ? <SubsystemTable view={view} /> : null}
          {view.reports.length > 0 ? (
            <ReportHistory view={view} busy={busy} mutate={mutate} />
          ) : (
            <EmptyState
              badge="No runs yet"
              badgeTone="setup"
              title="Run your first reconciliation"
              description="Log weights in Weight Budget and current loads in Power Loads, then run a reconciliation to see drift and a trim proposal."
            />
          )}
        </div>
      )}
    </main>
  );
}

function BudgetTiles({ view }: { view: LiveView }) {
  const { mass, current } = view;
  return (
    <section
      className="app-card soft-panel"
      style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 20 }}
    >
      <div>
        <span className={`app-badge ${STATUS_TONE[mass.status]}`}>{budgetStatusLabel(mass.status)}</span>
        <h2 style={{ margin: "6px 0 0" }}>Mass</h2>
        <strong style={{ fontSize: "1.6rem", display: "block" }}>
          {mass.totalLbs} / {mass.limitLbs} lb
        </strong>
        <small className="app-muted">
          {mass.driftLbs >= 0 ? "+" : ""}
          {mass.driftLbs} lb ({pct(mass.driftPct)}) vs. limit
        </small>
      </div>
      <div>
        <span className={`app-badge ${STATUS_TONE[current.status]}`}>{budgetStatusLabel(current.status)}</span>
        <h2 style={{ margin: "6px 0 0" }}>Current draw</h2>
        <strong style={{ fontSize: "1.6rem", display: "block" }}>
          {current.totalAmps} / {current.breakerAmps} A
        </strong>
        <small className="app-muted">
          {current.driftAmps >= 0 ? "+" : ""}
          {current.driftAmps} A ({pct(current.driftPct)}) vs. summed breaker budget
        </small>
      </div>
    </section>
  );
}

function RunPanel({
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
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <h2 style={{ margin: 0 }}>Trim proposal</h2>
          <small className="app-muted">Computed from as-designed weight_components and power_loads.</small>
        </div>
        <button type="button" className="app-button" disabled={busy} onClick={() => mutate({ action: "run-reconciliation" })}>
          Run reconciliation
        </button>
      </header>
      {view.trimProposal ? (
        <div style={{ marginTop: 12 }}>
          <strong>
            {view.trimProposal.subsystem} — trim ~{view.trimProposal.recommendedTrimLbs} lb
          </strong>
          <p style={{ margin: "4px 0 0" }}>{view.trimProposal.rationale}</p>
        </div>
      ) : (
        <p className="app-muted" style={{ marginTop: 12 }}>
          {view.mass.status === "over"
            ? "Mass is over budget, but no subsystem has weight_components logged to trim from."
            : "Mass is within target — no trim needed right now."}
        </p>
      )}
    </Panel>
  );
}

function SubsystemTable({ view }: { view: LiveView }) {
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>By subsystem</h2>
      <ul className="factor-table" style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
        {view.subsystems.map((row) => (
          <li key={row.subsystem} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <span>{row.subsystem}</span>
            <small className="app-muted">
              {row.massLbs} lb · {row.currentAmps} A
            </small>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function ReportHistory({
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
      <h2 style={{ marginTop: 0 }}>Reconciliation history</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.reports.map((report) => (
          <li
            key={report.id}
            className="app-card soft-panel"
            style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}
          >
            <div>
              <span className={`app-badge ${STATUS_TONE[report.massStatus]}`}>
                {budgetStatusLabel(report.massStatus)}
              </span>
              <strong style={{ display: "block", marginTop: 4 }}>
                {report.massTotalLbs} / {report.massLimitLbs} lb · {report.currentTotalAmps} / {report.currentBreakerAmps} A
              </strong>
              <small className="app-muted" style={{ display: "block" }}>
                {new Date(report.createdAt).toLocaleString()}
              </small>
              {report.trimSubsystem ? (
                <small className="app-muted">
                  Trim {report.trimSubsystem} ~{report.trimAmountLbs} lb — {report.rationale}
                </small>
              ) : (
                <small className="app-muted">{report.rationale}</small>
              )}
            </div>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => mutate({ action: "delete-report", reportId: report.id })}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
