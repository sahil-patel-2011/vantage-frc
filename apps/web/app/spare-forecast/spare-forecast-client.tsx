"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, PageHeader, Panel, Button } from "../../components/ui";
import { PURCHASE_REQUEST_STATUSES, forecastUrgencyLabel } from "../../lib/spare-forecast";
import type { SpareForecastView } from "../../lib/spare-forecast/compute-spare-forecast";
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
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
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

function isSpareForecastView(value: unknown): value is SpareForecastView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

function spareForecastCacheOrg(data: SpareForecastView, orgHint: string): string {
  if ("orgId" in data && typeof data.orgId === "string" && data.orgId.trim()) return data.orgId;
  return orgHint;
}

async function persistSpareForecastSnapshot(
  orgHint: string,
  seasonHint: string,
  data: SpareForecastView,
): Promise<void> {
  const cacheOrg = spareForecastCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  const seasonKey = String(data.seasonYear);
  try {
    await putFeatureSnapshot("spare-forecast", cacheOrg, data, seasonHint || seasonKey);
    if (!orgHint) await putFeatureSnapshot("spare-forecast", "_", data, seasonHint || seasonKey);
  } catch {
    // Live Spares forecast already painted; IndexedDB is best-effort.
  }
}

function SpareForecastRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = spareForecastRelatedLinks(orgId, { include: [...SPARE_FORECAST_RELATED_INCLUDE] });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related spare-forecast-related" aria-label="Related spare tools">
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
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
  // The crumb is the Build hub, not the FMEA tab inside it: a breadcrumb that
  // says "Build" and lands on a sibling tool is a third door to FMEA wearing
  // the name of the parent.
  const buildHref = withOrgHref("/build", orgId);
  const copy = spareForecastShellCopy(shell);
  const inventoryHref = withOrgHref("/inventory", orgId);
  const ordersHref = hubHref("/business", "orders", orgId);
  const subsystemsHref = withOrgHref("/subsystems", orgId);

  return (
    <main className="module-page spare-forecast-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={buildHref}>Build</a>
            {" / Spares forecast"}
          </>
        }
        title="Spares forecast"
        description={description}
      >
        <SpareForecastRelatedStrip orgId={orgId} />
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
          <Button variant="secondary" type="button" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
        {shell === "setup" ? (
          <Button as="a" variant="primary" href={orgId ? withOrgHref("/workspace", orgId) : "/workspace"}>Choose your team</Button>
        ) : null}
        {shell === "empty" ? (
          <Button as="a" variant="primary" href={inventoryHref}>Open Inventory</Button>
        ) : null}
        {shell === "no_risk" ? (
          <>
            <Button as="a" variant="primary" href={hubHref("/build", "fmea", orgId)}>
              Open Failure log
            </Button>
            <Button as="a" variant="secondary" href={subsystemsHref}>
              Open Subsystems
            </Button>
            <Button as="a" variant="secondary" href={ordersHref}>
              Open Orders
            </Button>
          </>
        ) : null}
      </EmptyState>
      {shell === "ready" ? <SpareForecastNextActionsPanel actions={actions} /> : null}
    </main>
  );
}

export default function SpareForecastClient() {
  const [view, setView] = useState<SpareForecastView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<SpareForecastView | null>(null);
  viewRef.current = view;

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
        const cached = await getFeatureSnapshot<SpareForecastView>(
          "spare-forecast",
          urlOrg || "_",
          seasonHint,
        );
        if (!viewRef.current && cached?.data && isSpareForecastView(cached.data)) {
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
          `/api/spare-forecast${query.toString() ? `?${query.toString()}` : ""}`,
          {
            cache: "no-store",
            signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
          },
        );
        const data = (await response.json()) as SpareForecastView | { error?: string };
        if (!response.ok || !isSpareForecastView(data)) {
          if (hadCache || viewRef.current) {
            setFromCache(true);
            setError("Could not refresh Spares forecast. Showing the last copy on this device.");
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
        await persistSpareForecastSnapshot(urlOrg, seasonHint, data);
      } catch {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Spares forecast. Showing the last copy on this device.");
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
    seasonHorizon: view?.status === "live" ? view.seasonHorizon : undefined,
  });
  // FMEA, Orders and Subsystems appeared three times on one screen: the header
  // strip, the Next actions list, and the empty-state buttons. Next actions is
  // the copy that says *why* to go, so it wins; the strip keeps whatever it is
  // not already offering, and the empty state offers none of them.
  const nextActionHrefs = new Set(nextActions.map((action) => action.href));
  /** Drop any button whose destination the Next actions panel already offers. */
  const shellActions = (buttons: Array<{ href: string; label: string; primary?: boolean }>) =>
    buttons
      .filter((button) => !nextActionHrefs.has(button.href))
      .map((button, index) => (
        <a
          key={button.href}
          className={button.primary || index === 0 ? "app-button" : "app-button secondary"}
          href={button.href}
        >
          {button.label}
        </a>
      ));
  const relatedLinks = spareForecastRelatedLinks(orgId, {
    include: [...SPARE_FORECAST_RELATED_INCLUDE],
  }).filter((link) => !nextActionHrefs.has(link.href));
  const buildHref = withOrgHref("/build", orgId);
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
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data = (await response.json()) as SpareForecastView | { error?: string };
        if (!response.ok || !isSpareForecastView(data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
        void persistSpareForecastSnapshot(orgId, season != null ? String(season) : "", data);
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
      <SpareForecastShell description={shellCopy.description} orgId={null} shell="loading">
        <OfflineBanner feature="Spares forecast" fromCache={fromCache} cachedAt={cachedAt} />
      </SpareForecastShell>
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
      >
        <OfflineBanner feature="Spares forecast" fromCache={fromCache} cachedAt={cachedAt} />
      </SpareForecastShell>
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
      >
        <OfflineBanner feature="Spares forecast" fromCache={fromCache} cachedAt={cachedAt} />
      </SpareForecastShell>
    );
  }

  if (view?.status !== "live") {
    return (
      <SpareForecastShell description={shellCopy.description} orgId={orgId} shell="setup">
        <OfflineBanner feature="Spares forecast" fromCache={fromCache} cachedAt={cachedAt} />
      </SpareForecastShell>
    );
  }

  return (
    <main className="module-page spare-forecast-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={buildHref}>Build</a>
            {" / Spares forecast"}
          </>
        }
        title="Spares forecast"
        description={
          view.seasonHorizon === "offseason"
            ? "Offseason: remaining-season risk is unknown. Cadence still uses real spare-category bins × logged failures — never \"no risk\" from a closed 200-day window."
            : "Projects which real spare bins will run out before the season ends — Failure log cadence × quantity on hand. Cross-check Batteries, Orders, and Subsystems."
        }
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
            <Button as="a" variant="secondary" key={link.id} href={link.href}>
              {link.label}
            </Button>
          ))}
        </div>
      </PageHeader>

      <OfflineBanner feature="Spares forecast" fromCache={fromCache} cachedAt={cachedAt} />

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
          {/* Only what Next actions is not already offering — this empty state
              used to repeat all three of them a scroll below the panel. */}
          {shellActions([
            { href: inventoryHref, label: "Open Inventory", primary: true },
            { href: subsystemsHref, label: "Open Subsystems" },
            { href: batteriesHref, label: "Open Batteries" },
          ])}
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
          {shellActions([
            { href: hubHref("/build", "fmea", orgId), label: "Open Failure log", primary: true },
            { href: subsystemsHref, label: "Open Subsystems" },
            { href: ordersHref, label: "Open Orders" },
          ])}
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
              <a href={subsystemsHref}>Subsystems</a> aligned with inventory tags.
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
  const scoredExhaust = view.forecastLines.filter((line) => line.forecast.willExhaust != null);
  const willExhaust =
    scoredExhaust.length === 0 && view.forecastLines.length > 0
      ? null
      : scoredExhaust.filter((line) => line.forecast.willExhaust === true).length;
  const offseason = view.seasonHorizon === "offseason";
  // `consumableSpareCount` is a subset of `spareBinCount`, not a second pile:
  // both counts come from the same `is_spare` rows, and the consumables among
  // them are the ones /spares manages. Saying so on the tile stops the two
  // numbers reading as two unrelated features that happen to sit together.
  const consumables = view.consumableSpareCount;
  const parts = Math.max(0, view.spareBinCount - consumables);
  const tiles: Array<{ label: string; value: string; hint?: string }> = [
    {
      label: "Spare bins",
      value: formatSpareForecastMetric(view.spareBinCount, loaded),
      hint:
        !loaded || view.spareBinCount === 0
          ? undefined
          : consumables === 0
            ? `${parts} ${parts === 1 ? "part" : "parts"}`
            : parts === 0
              ? `${consumables} ${consumables === 1 ? "consumable" : "consumables"}`
              : `${parts} ${parts === 1 ? "part" : "parts"} · ${consumables} ${consumables === 1 ? "consumable" : "consumables"}`,
    },
    { label: "Forecasted", value: formatSpareForecastMetric(view.forecastLines.length, loaded) },
    { label: "Will exhaust", value: formatSpareForecastMetric(willExhaust, loaded) },
    { label: "Critical", value: formatSpareForecastMetric(offseason ? null : critical, loaded) },
  ];
  return (
    <Panel className="spare-forecast-coverage" aria-label="Spares forecast summary">
      <div className="spare-forecast-stats">
        <div>
          <span
            className={`app-badge ${
              view.spareBinCount === 0
                ? "setup"
                : offseason
                  ? "setup"
                  : view.forecastLines.length === 0
                    ? "setup"
                    : "demo"
            }`}
          >
            {view.spareBinCount === 0
              ? "EMPTY"
              : offseason
                ? "OFFSEASON"
                : view.forecastLines.length === 0
                  ? "NO HISTORY"
                  : "LIVE"}
          </span>
          <h2 style={{ margin: "6px 0 0" }}>Season forecast</h2>
          <small className="app-muted">
            {offseason
              ? "Remaining-season risk is unknown — cadence from inventory × Failure log only"
              : "Real inventory only."}
          </small>
        </div>
        {tiles.map((tile) => (
          <div key={tile.label}>
            <strong>{tile.value}</strong>
            <small className="app-muted" style={{ display: "block" }}>
              {tile.label}
            </small>
            {tile.hint ? (
              <small className="app-muted" style={{ display: "block" }} data-testid="spare-bin-breakdown">
                {tile.hint}
              </small>
            ) : null}
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
            Real spare-category bins with matched Failure log history only.
          </p>
        </div>
        {view.seasonHorizon === "offseason" ? (
          <p className="app-muted spare-forecast-offseason-note">
            Season window closed — remaining-season risk is unknown. Logged Failure log cadence is still
            shown. Draft restock when a live horizon exists.
          </p>
        ) : (
          <div className="spare-forecast-draft-actions">
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={`Spare-parts restock — ${view.seasonYear}`}
              aria-label="Purchase request title"
            />
            <Button variant="primary" type="button" disabled={busy} onClick={() => { mutate({ action: "draft-purchase-request", title: title.trim() || undefined }); setTitle(""); }}>
              Draft purchase request
            </Button>
            <p className="app-muted">
              This draft is a restock reminder. Enter what / why / when / cost on the{" "}
              <a href={withOrgHref("/team/finance", view.orgId)}>Team Finance buy sheet</a>.
            </p>
          </div>
        )}
      </header>
      <ul className="spare-forecast-list">
        {view.forecastLines.map((line) => (
          <li key={line.itemId} className="app-card soft-panel spare-forecast-card">
            <header className="spare-forecast-card-head">
              <div>
                <span
                  className={`app-badge ${
                    line.forecast.urgency ? URGENCY_TONE[line.forecast.urgency] : "setup"
                  }`}
                >
                  {forecastUrgencyLabel(line.forecast.urgency)}
                </span>
                <strong style={{ display: "block", marginTop: 4 }}>{line.itemName}</strong>
                <small className="app-muted">
                  {line.subsystem ?? "Unmatched subsystem"} · {line.quantityOnHand} on hand ·{" "}
                  {line.failureCount} logged failure(s) this season
                </small>
              </div>
            </header>
            <small className="app-muted">
              {line.forecast.horizon === "offseason" || line.forecast.daysRemaining == null
                ? `${line.forecast.consumptionPerDay.toFixed(3)} units/day from ${line.failureCount} logged failure(s) over ${line.forecast.daysElapsed} season day(s). Remaining-season risk is unknown — the season window is closed.`
                : `${line.forecast.consumptionPerDay.toFixed(3)} units/day cadence · ${line.forecast.projectedConsumptionRemaining} projected over ${line.forecast.daysRemaining} remaining day(s)${
                    line.forecast.willExhaust
                      ? ` · shortfall of ${line.forecast.projectedShortfall} · recommend ordering ${line.forecast.recommendedOrderQty}`
                      : " · not projected to run out"
                  }`}
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
                  <Button variant="secondary" key={status} type="button" disabled={busy} onClick={() => mutate({ action: "update-status", requestId: request.id, status })}>
                    Mark {STATUS_LABEL[status].toLowerCase()}
                  </Button>
                ))}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
