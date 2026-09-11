"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, PageHeader, Panel, Button } from "../../components/ui";
import { budgetStatusLabel } from "../../lib/budget-reconciler";
import type { BudgetReconcilerView } from "../../lib/budget-reconciler/compute-budget-reconciler";
import type { BudgetStatus } from "../../lib/budget-reconciler/types";
import { hubHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

const STATUS_TONE: Record<BudgetStatus, string> = {
  over: "setup",
  under: "good",
  on_target: "good",
};

function pct(value: number): string {
  return `${value >= 0 ? "+" : ""}${Math.round(value * 100)}%`;
}

type LiveView = Extract<BudgetReconcilerView, { status: "live" }>;

function isBudgetReconcilerView(value: unknown): value is BudgetReconcilerView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

function responseError(data: unknown): string {
  return data && typeof data === "object" && "error" in data && typeof data.error === "string"
    ? data.error
    : "";
}

function budgetReconcilerCacheOrg(data: BudgetReconcilerView, orgHint: string): string {
  switch (data.status) {
    case "setup_required":
      return (typeof data.orgId === "string" && data.orgId.trim()) || orgHint;
    case "live":
      return data.orgId.trim() || orgHint;
    default: {
      data satisfies never;
      return orgHint;
    }
  }
}

async function persistBudgetReconcilerSnapshot(
  orgHint: string,
  seasonHint: string,
  data: BudgetReconcilerView,
): Promise<void> {
  const cacheOrg = budgetReconcilerCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  const seasonKey = String(data.seasonYear);
  try {
    await putFeatureSnapshot("budget-reconciler", cacheOrg, data, seasonHint || seasonKey);
    if (!orgHint) await putFeatureSnapshot("budget-reconciler", "_", data, seasonHint || seasonKey);
  } catch {
    // Live Budget check already painted; IndexedDB is best-effort.
  }
}

function BudgetReconcilerRelated({ orgId }: { orgId?: string | null }) {
  return (
    <nav className="product-hub-related" aria-label="Related robot tools">
      <Button as="a" variant="secondary" href={hubHref("/build", "weight-budget", orgId)}>
        Weight budget
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/build", "power-budget", orgId)}>
        Power budget
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/build", "bom-cost-rollup", orgId)}>
        BOM cost
      </Button>
    </nav>
  );
}

function BudgetReconcilerNextActions({ orgId }: { orgId: string }) {
  const actions = [
    {
      id: "run",
      label: "Run a reconciliation",
      detail: "Compare logged weight and current draw to the season limits.",
      href: "#budget-check-run",
      primary: true,
    },
    {
      id: "weight",
      label: "Open Weight budget",
      detail: "Subsystem masses feed this board.",
      href: hubHref("/build", "weight-budget", orgId),
      primary: false,
    },
    {
      id: "bom",
      label: "Open BOM cost",
      detail: "Part dollars are a separate rollup from weight and power.",
      href: hubHref("/build", "bom-cost-rollup", orgId),
      primary: false,
    },
  ];
  return (
    <section className="app-card soft-panel edc-next-actions" aria-label="Next actions">
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

export default function BudgetReconcilerClient() {
  const [view, setView] = useState<BudgetReconcilerView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [failureStatus, setFailureStatus] = useState<number | null>(null);
  const [failureMessage, setFailureMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<BudgetReconcilerView | null>(null);
  viewRef.current = view;

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback(async (seasonOverride?: number) => {
    const params = new URLSearchParams(window.location.search);
    const orgHint = params.get("orgId")?.trim() ?? "";
    const seasonQuery = seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
    const seasonHint =
      seasonQuery && Number.isFinite(seasonQuery) ? String(seasonQuery) : String(new Date().getFullYear());
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<BudgetReconcilerView>(
        "budget-reconciler",
        orgHint || "_",
        seasonHint,
      );
      if (!viewRef.current && cached?.data && isBudgetReconcilerView(cached.data)) {
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
    setFailureStatus(null);
    setFailureMessage("");
    setError("");
    try {
      const query = new URLSearchParams();
      if (orgHint) query.set("orgId", orgHint);
      if (seasonQuery) query.set("season", String(seasonQuery));
      const response = await fetch(`/api/budget-reconciler${query.toString() ? `?${query.toString()}` : ""}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data: unknown = await response.json().catch(() => null);
      if (response.status === 401 || response.status === 403) {
        setView(null);
        setFromCache(false);
        setCachedAt(null);
        setFetchFailed(true);
        setFailureStatus(response.status);
        setFailureMessage(responseError(data));
        return;
      }
      if (!response.ok || !isBudgetReconcilerView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Budget check. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setFetchFailed(true);
        setFailureStatus(response.status);
        setFailureMessage(responseError(data));
        return;
      }
      setView(data);
      setSeason(data.seasonYear);
      setFromCache(false);
      setCachedAt(null);
      await persistBudgetReconcilerSnapshot(orgHint, seasonHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setError("Could not refresh Budget check. Showing the last copy on this device.");
        setFetchFailed(false);
        return;
      }
      setFetchFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
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
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data: unknown = await response.json().catch(() => null);
        if (!response.ok || !isBudgetReconcilerView(data)) {
          setError(responseError(data) || "Something went wrong.");
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
        setFromCache(false);
        void persistBudgetReconcilerSnapshot(orgId, String(data.seasonYear), data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, season, busy],
  );

  const buildHref = orgId ? `/build?orgId=${encodeURIComponent(orgId)}` : "/build";
  const header = (
    <PageHeader
      breadcrumbs={
        <>
          <a href={buildHref}>Build</a>
          {" / Budget check"}
        </>
      }
      title="Budget check"
      description="Watches the as-designed weight and power budgets, flags drift past target, and proposes which subsystem to trim."
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
                void load(next);
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
        <BudgetReconcilerRelated orgId={orgId} />
      </div>
    </PageHeader>
  );

  if (!view) {
    const failure = fetchFailed
      ? loadFailureCopy(
          classifyLoadFailure({
            status: failureStatus,
            message: failureMessage,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          }),
          {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message: failureMessage || "A network or server issue prevented loading. Try again.",
          },
        )
      : null;
    return (
      <main className="module-page">
        {header}
        <OfflineBanner feature="Budget check" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          title={failure ? failure.title : "Loading…"}
          description={failure ? failure.description : "Checking your team."}
          aria-busy={!fetchFailed}
        >
          {failure?.primary ? (
            <Button as="a" variant="primary" href={failure.primary.href}>
              {failure.primary.label}
            </Button>
          ) : null}
          {failure?.showRetry ? (
            <Button variant="secondary" type="button" onClick={() => void load()}>
              Retry
            </Button>
          ) : null}
        </EmptyState>
      </main>
    );
  }

  switch (view.status) {
    case "setup_required":
      return (
        <main className="module-page">
          {header}
          <OfflineBanner feature="Budget check" fromCache={fromCache} cachedAt={cachedAt} />
          {error ? (
            <p className="telemetry-status" role="alert">
              {error}
            </p>
          ) : null}
          <EmptyState badge="Setup required" badgeTone="setup" title={view.message}>
            {view.steps[0] ? (
              <Button as="a" variant="primary" href={view.steps[0].href}>
                {view.steps[0].label}
              </Button>
            ) : null}
          </EmptyState>
        </main>
      );
    case "live":
      break;
    default: {
      view satisfies never;
      return null;
    }
  }

  return (
    <main className="module-page">
      {header}
      <OfflineBanner feature="Budget check" fromCache={fromCache} cachedAt={cachedAt} />
      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}
      <BudgetReconcilerNextActions orgId={view.orgId} />
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
    <Panel id="budget-check-run">
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <h2 style={{ margin: 0 }}>Trim proposal</h2>
          <small className="app-muted">Computed from logged subsystem weights and current draws.</small>
        </div>
        <Button variant="primary" type="button" disabled={busy} onClick={() => mutate({ action: "run-reconciliation" })}>
          Run check
        </Button>
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
