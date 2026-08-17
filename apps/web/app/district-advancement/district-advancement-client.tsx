"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, PageHeader, Panel } from "../../components/ui";
import type { TrajectoryView } from "../../lib/district-trajectory-sim/compute-district-trajectory-sim";
import { withOrgHref } from "../../lib/nav/product-nav";

export default function DistrictAdvancementClient() {
  const [view, setView] = useState<TrajectoryView | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    const orgId = new URLSearchParams(window.location.search).get("orgId");
    const query = orgId ? `?orgId=${encodeURIComponent(orgId)}` : "";
    void fetch(`/api/district-advancement${query}`)
      .then(async (response) => {
        const data = (await response.json()) as TrajectoryView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("Could not load district advancement.");
          return;
        }
        setView(data);
      })
      .catch(() => setError("Network error — please try again."));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const orgId = view && "orgId" in view ? view.orgId : null;

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/competition?orgId=${encodeURIComponent(orgId)}` : "/competition"}>Competition</a>
            {" / District advancement"}
          </>
        }
        title="District advancement"
        description="Project remaining district points from cached EPA and the remaining event list — never DEMO qualification odds."
      />
      {error ? <p className="app-muted">{error}</p> : null}
      {!view ? <p className="app-muted">Loading…</p> : null}
      {view?.status === "setup_required" ? (
        <EmptyState title="Not enough district data yet" description={view.message}>
            <ol>
              {view.steps.map((step) => (
                <li key={step.id}>
                  <a href={step.href}>{step.label}</a> — {step.detail}
                </li>
              ))}
            </ol>
        </EmptyState>
      ) : null}
      {view?.status === "live" ? (
        <Panel>
          <p>
            {view.districtKey} · {view.remainingEvents.length} remaining events · team {view.teamNumber}
          </p>
          {view.latestRun ? (
            <dl>
              <div>
                <dt>Median projected points</dt>
                <dd>{view.latestRun.projectedPointsP50 ?? "—"}</dd>
              </div>
              <div>
                <dt>Qualify probability</dt>
                <dd>
                  {view.latestRun.qualifyProbability != null
                    ? `${Math.round(view.latestRun.qualifyProbability * 100)}%`
                    : "—"}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="app-muted">No saved run yet — live projection uses the current cache only.</p>
          )}
          <p>
            <a className="app-button secondary" href={withOrgHref("/strategy", view.orgId)}>
              Open Strategy
            </a>
          </p>
        </Panel>
      ) : null}
    </main>
  );
}
