"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { EmptyState, PageHeader, Panel } from "../../components/ui";
import { forecastUrgencyLabel } from "../../lib/spare-forecast";
import {
  PURCHASE_REQUEST_STATUSES,
  type SpareForecastView,
} from "../../lib/spare-forecast/compute-spare-forecast";
import {
  SPARE_FORECAST_RELATED_INCLUDE,
  classifySpareForecastShell,
  formatSpareForecastMetric,
  spareForecastNextActions,
  spareForecastRelatedLinks,
  spareForecastShellCopy,
  type SpareForecastNextAction,
  type SpareForecastShellKind,
} from "../../lib/spare-forecast/spare-forecast-related";
import type { ForecastUrgency, PurchaseRequestStatus } from "../../lib/spare-forecast/types";
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./spare-forecast.css";

const URGENCY_TONE: Record<ForecastUrgency, string> = {
  critical: "danger",
  warning: "demo",
  watch: "setup",
  stable: "good",
};

const STATUS_LABEL: Record<PurchaseRequestStatus, string> = {
  draft: "Draft",
  approved: "Approved",
  ordered: "Ordered",
  dismissed: "Dismissed",
};

type LiveView = Extract<SpareForecastView, { status: "live" }>;

function SpareForecastRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = spareForecastRelatedLinks(orgId, { include: [...SPARE_FORECAST_RELATED_INCLUDE] });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related spare-forecast-related" aria-label="Related spare tools">
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

function SpareForecastNextActionsPanel({ actions }: { actions: SpareForecastNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section
      className="app-card soft-panel edc-next-actions spare-forecast-next-actions"
      aria-label="Next actions"
    >
      <header>
        <h2>Next actions</h2>
        <p className="app-muted">Batteries, Orders, and Subsystems — never DEMO spare counts.</p>
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

function SpareForecastShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: SpareForecastShellKind;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = spareForecastNextActions({ orgId, shell });
  const buildHref = hubHref("/build", "fmea", orgId);
  const copy = spareForecastShellCopy(shell);
  const inventoryHref = withOrgHref("/inventory", orgId);
  const batteriesHref = hubHref("/team", "batteries", orgId);
  const ordersHref = hubHref("/business", "orders", orgId);
  const subsystemsHref = withOrgHref("/subsystems", orgId);

  return (
    <main className="module-page spare-forecast-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={buildHref}>Build</a>
            {" / Spare Forecast"}
          </>
        }
        title="Spare-Parts Failure Forecast"
        description={description}
      >
        <SpareForecastRelatedStrip orgId={orgId} />
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
                ? "No spare bins yet"
                : shell === "no_risk"
                  ? "No exhaustion risk"
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
            <a className="app-button" href={inventoryHref}>
              Open Inventory
            </a>
            <a className="app-button secondary" href={subsystemsHref}>
              Open Subsystems
            </a>
            <a className="app-button secondary" href={batteriesHref}>
              Open Batteries
            </a>
          </>
        ) : null}
        {shell === "no_risk" ? (
          <>
            <a className="app-button" href={hubHref("/build", "fmea", orgId)}>
              Open FMEA
            </a>
            <a className="app-button secondary" href={subsystemsHref}>
              Open Subsystems
            </a>
            <a className="app-button secondary" href={ordersHref}>
              Open Orders
            </a>
          </>
        ) : null}
      </EmptyState>
      <SpareForecastNextActionsPanel actions={actions} />
    </main>
  );
}

export default function SpareForecastClient() {
  const [view, setView] = useState<SpareForecastView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);

  const load = useCallback((seasonOverride?: number) => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const seasonQuery = seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (seasonQuery) query.set("season", String(seasonQuery));
    void fetch(`/api/spare-forecast${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as SpareForecastView | { error?: string };
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

  const orgId = view && "orgId" in view ? view.orgId : null;
  const spareBinCount = view?.status === "live" ? view.spareBinCount : 0;
  const forecastLineCount = view?.status === "live" ? view.forecastLines.length : 0;
  const criticalCount =
    view?.status === "live"
      ? view.forecastLines.filter((line) => line.forecast.urgency === "critical").length
      : 0;
  const purchaseRequestCount = view?.status === "live" ? view.purchaseRequests.length : 0;

  const shell = classifySpareForecastShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId: view?.status === "live" ? view.orgId : view?.status === "setup_required" ? view.orgId : null,
    spareBinCount,
    forecastLineCount,
  });
  const shellCopy = spareForecastShellCopy(shell);
  const nextActions = spareForecastNextActions({
    orgId,
    shell,
    spareBinCount,
    forecastLineCount,
    criticalCount,
    purchaseRequestCount,
  });
  const relatedLinks = spareForecastRelatedLinks(orgId, {
    include: [...SPARE_FORECAST_RELATED_INCLUDE],
  });
  const buildHref = hubHref("/build", "fmea", orgId);
  const batteriesHref = hubHref("/team", "batteries", orgId);
  const ordersHref = hubHref("/business", "orders", orgId);
  const subsystemsHref = withOrgHref("/subsystems", orgId);
  const inventoryHref = withOrgHref("/inventory", orgId);

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/spare-forecast", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        });
        const data = (await response.json()) as SpareForecastView | { error?: string };
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

  if (shell === "loading") {
    return (
      <SpareForecastShell description={shellCopy.description} orgId={null} shell="loading" />
    );
  }

  if (shell === "error") {
    return (
      <SpareForecastShell
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
      <SpareForecastShell
        description={
          view?.status === "setup_required" ? view.message : shellCopy.description
        }
        orgId={orgId}
        shell="setup"
      />
    );
  }

  if (view?.status !== "live") {
    return <SpareForecastShell description={shellCopy.description} orgId={orgId} shell="setup" />;
  }

  return (
    <main className="module-page spare-forecast-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={buildHref}>Build</a>
            {" / Spare Forecast"}
          </>
        }
        title="Spare-Parts Failure Forecast"
        description="Projects which real spare bins will run out before the season ends — FMEA cadence × quantity on hand. Cross-check Batteries, Orders, and Subsystems — never DEMO spare counts."
      >
        <div className="spare-forecast-header-actions">
          {view.seasons.length > 0 ? (
            <label className="app-muted spare-forecast-season">
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

      <SpareForecastNextActionsPanel actions={nextActions} />

      {shell === "empty" ? (
        <EmptyState
          soft
          badge="No spare bins yet"
          badgeTone="setup"
          title={shellCopy.title}
          description={shellCopy.description}
        >
          <a className="app-button" href={inventoryHref}>
            Open Inventory
          </a>
          <a className="app-button secondary" href={subsystemsHref}>
            Open Subsystems
          </a>
          <a className="app-button secondary" href={batteriesHref}>
            Open Batteries
          </a>
        </EmptyState>
      ) : null}

      {shell === "no_risk" ? (
        <EmptyState
          soft
          badge="No exhaustion risk"
          badgeTone="good"
          title={shellCopy.title}
          description={shellCopy.description}
        >
          <a className="app-button" href={hubHref("/build", "fmea", orgId)}>
            Open FMEA
          </a>
          <a className="app-button secondary" href={subsystemsHref}>
            Open Subsystems
          </a>
          <a className="app-button secondary" href={ordersHref}>
            Open Orders
          </a>
        </EmptyState>
      ) : null}

      <SummaryTiles view={view} loaded />

      {shell === "ready" ? (
        <div className="spare-forecast-layout">
          <ForecastPanel view={view} busy={busy} mutate={mutate} />
          <Panel className="spare-forecast-tip" aria-label="Restock tip">
            <span className="eyebrow">Restock path</span>
            <p className="app-muted" style={{ marginTop: 8 }}>
              Draft from projected shortfalls, then promote through{" "}
              <a href={ordersHref}>Orders</a>. Keep{" "}
              <a href={batteriesHref}>Batteries</a> and{" "}
              <a href={subsystemsHref}>Subsystems</a> aligned with inventory tags — never invent DEMO
              spare counts.
            </p>
          </Panel>
        </div>
      ) : null}

      {view.purchaseRequests.length > 0 ? (
        <PurchaseRequestsList view={view} busy={busy} mutate={mutate} />
      ) : null}
    </main>
  );
}

function SummaryTiles({ view, loaded }: { view: LiveView; loaded: boolean }) {
  const critical = view.forecastLines.filter((line) => line.forecast.urgency === "critical").length;
  const willExhaust = view.forecastLines.filter((line) => line.forecast.willExhaust).length;
  const tiles = [
    { label: "Spare bins", value: formatSpareForecastMetric(view.spareBinCount, loaded) },
    { label: "Forecasted", value: formatSpareForecastMetric(view.forecastLines.length, loaded) },
    { label: "Will exhaust", value: formatSpareForecastMetric(willExhaust, loaded) },
    { label: "Critical", value: formatSpareForecastMetric(critical, loaded) },
  ];
  return (
    <Panel className="spare-forecast-coverage" aria-label="Spare Forecast summary">
      <div className="spare-forecast-stats">
        <div>
          <span
            className={`app-badge ${
              view.spareBinCount === 0 ? "setup" : view.forecastLines.length === 0 ? "good" : "demo"
            }`}
          >
            {view.spareBinCount === 0 ? "EMPTY" : view.forecastLines.length === 0 ? "STABLE" : "LIVE"}
          </span>
          <h2 style={{ margin: "6px 0 0" }}>Season forecast</h2>
          <small className="app-muted">Real inventory only — never DEMO spare counts</small>
        </div>
        {tiles.map((tile) => (
          <div key={tile.label}>
            <strong>{tile.value}</strong>
            <small className="app-muted" style={{ display: "block" }}>
              {tile.label}
            </small>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function ForecastPanel({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const [title, setTitle] = useState("");

  return (
    <Panel id="spare-forecast-draft" className="spare-forecast-panel">
      <header className="spare-forecast-panel-head">
        <div>
          <h2 style={{ margin: 0 }}>Exhaustion forecast</h2>
          <p className="app-muted" style={{ margin: "4px 0 0" }}>
            Real spare-category bins with matched FMEA history only.
          </p>
        </div>
        <div className="spare-forecast-draft-actions">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={`Spare-parts restock — ${view.seasonYear}`}
            aria-label="Purchase request title"
          />
          <button
            type="button"
            className="app-button"
            disabled={busy}
            onClick={() => {
              mutate({ action: "draft-purchase-request", title: title.trim() || undefined });
              setTitle("");
            }}
          >
            Draft purchase request
          </button>
        </div>
      </header>
      <ul className="spare-forecast-list">
        {view.forecastLines.map((line) => (
          <li key={line.itemId} className="app-card soft-panel spare-forecast-card">
            <header className="spare-forecast-card-head">
              <div>
                <span className={`app-badge ${URGENCY_TONE[line.forecast.urgency]}`}>
                  {forecastUrgencyLabel(line.forecast.urgency)}
                </span>
                <strong style={{ display: "block", marginTop: 4 }}>{line.itemName}</strong>
                <small className="app-muted">
                  {line.subsystem ?? "Unmatched subsystem"} · {line.quantityOnHand} on hand ·{" "}
                  {line.failureCount} FMEA failure(s) this season
                </small>
              </div>
            </header>
            <small className="app-muted">
              {line.forecast.consumptionPerDay.toFixed(3)} units/day cadence ·{" "}
              {line.forecast.projectedConsumptionRemaining} projected over{" "}
              {line.forecast.daysRemaining} remaining day(s)
              {line.forecast.willExhaust
                ? ` · shortfall of ${line.forecast.projectedShortfall} · recommend ordering ${line.forecast.recommendedOrderQty}`
                : " · not projected to run out"}
            </small>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function PurchaseRequestsList({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  return (
    <Panel className="spare-forecast-requests">
      <h2 style={{ marginTop: 0 }}>Purchase requests</h2>
      <p className="app-muted" style={{ marginTop: 0 }}>
        Drafts from real projected shortfalls — promote through Orders when ready.
      </p>
      <ul className="spare-forecast-list">
        {view.purchaseRequests.map((request) => (
          <li key={request.id} className="app-card soft-panel spare-forecast-card">
            <header className="spare-forecast-card-head">
              <div>
                <strong>{request.title}</strong>
                <small className="app-muted" style={{ display: "block" }}>
                  {STATUS_LABEL[request.status]} · ${request.totalEstimatedCost.toFixed(2)} estimated ·{" "}
                  {request.lineItems.length} line item(s)
                </small>
              </div>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Delete "${request.title}"?`)) {
                    mutate({ action: "delete-request", requestId: request.id });
                  }
                }}
              >
                Delete
              </button>
            </header>
            <small className="app-muted">{request.rationale}</small>
            <ul className="factor-table spare-forecast-line-items">
              {request.lineItems.map((item) => (
                <li key={item.itemId}>
                  <span>
                    {item.itemName} × {item.quantityToOrder}
                  </span>
                  <small className="app-muted">${item.estimatedCost.toFixed(2)}</small>
                </li>
              ))}
            </ul>
            {request.status !== "dismissed" ? (
              <div className="spare-forecast-status-actions">
                {PURCHASE_REQUEST_STATUSES.filter((status) => status !== request.status).map((status) => (
                  <button
                    key={status}
                    type="button"
                    className="app-button secondary"
                    disabled={busy}
                    onClick={() => mutate({ action: "update-status", requestId: request.id, status })}
                  >
                    Mark {STATUS_LABEL[status].toLowerCase()}
                  </button>
                ))}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
