"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, PageHeader, Panel } from "../../components/ui";
import { forecastUrgencyLabel } from "../../lib/spare-forecast";
import {
  PURCHASE_REQUEST_STATUSES,
  type SpareForecastView,
} from "../../lib/spare-forecast/compute-spare-forecast";
import type { ForecastUrgency, PurchaseRequestStatus } from "../../lib/spare-forecast/types";

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

export default function SpareForecastClient() {
  const [view, setView] = useState<SpareForecastView | null>(null);
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

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/build?orgId=${encodeURIComponent(orgId)}` : "/build"}>Build</a>
            {" / Spare Forecast"}
          </>
        }
        title="Spare-Parts Failure Forecast"
        description="Projects which spares you'll run out of before the season ends — FMEA repeat-failure rate x bins on hand x consumption cadence — and drafts a purchase request from what would otherwise exhaust."
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
          title="Could not load spare-parts forecast"
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
          <ForecastPanel view={view} busy={busy} mutate={mutate} />
          {view.purchaseRequests.length > 0 ? (
            <PurchaseRequestsList view={view} busy={busy} mutate={mutate} />
          ) : null}
        </div>
      )}
    </main>
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

  if (view.forecastLines.length === 0) {
    return (
      <EmptyState
        badge="No exhaustion risk detected"
        badgeTone="good"
        title="No spares are currently projected to run out"
        description="Once spare-category inventory items are matched to a subsystem with logged FMEA failures, Vantage will project consumption cadence and flag what to reorder."
      />
    );
  }

  return (
    <Panel>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>Exhaustion forecast</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={`Spare-parts restock — ${view.seasonYear}`}
            style={{ minWidth: 220 }}
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
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10, marginTop: 12 }}>
        {view.forecastLines.map((line) => (
          <li key={line.itemId} className="app-card soft-panel" style={{ display: "grid", gap: 6 }}>
            <header style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
              <div>
                <span className={`app-badge ${URGENCY_TONE[line.forecast.urgency]}`}>
                  {forecastUrgencyLabel(line.forecast.urgency)}
                </span>
                <strong style={{ display: "block", marginTop: 4 }}>{line.itemName}</strong>
                <small className="app-muted">
                  {line.subsystem ?? "Unmatched subsystem"} · {line.quantityOnHand} on hand · {line.failureCount} FMEA
                  failure(s) this season
                </small>
              </div>
            </header>
            <small className="app-muted">
              {line.forecast.consumptionPerDay.toFixed(3)} units/day cadence · {line.forecast.projectedConsumptionRemaining}{" "}
              projected over {line.forecast.daysRemaining} remaining day(s)
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
    <Panel>
      <h2 style={{ marginTop: 0 }}>Purchase requests</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.purchaseRequests.map((request) => (
          <li key={request.id} className="app-card soft-panel" style={{ display: "grid", gap: 6 }}>
            <header style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
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
            <ul className="factor-table" style={{ listStyle: "none", padding: 0, display: "grid", gap: 4 }}>
              {request.lineItems.map((item) => (
                <li key={item.itemId} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span>
                    {item.itemName} × {item.quantityToOrder}
                  </span>
                  <small className="app-muted">${item.estimatedCost.toFixed(2)}</small>
                </li>
              ))}
            </ul>
            {request.status !== "dismissed" ? (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
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
