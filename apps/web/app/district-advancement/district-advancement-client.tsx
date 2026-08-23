"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, PageHeader, Panel } from "../../components/ui";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import type { TrajectoryView } from "../../lib/district-trajectory-sim/compute-district-trajectory-sim";
import { withOrgHref } from "../../lib/nav/product-nav";

export default function DistrictAdvancementClient() {
  const [view, setView] = useState<TrajectoryView | null>(null);
  const [error, setError] = useState("");
  // Kept so an expired session offers sign-in instead of a dead end.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);

  const load = useCallback(() => {
    setError("");
    setErrorStatus(null);
    const orgId = new URLSearchParams(window.location.search).get("orgId");
    const query = orgId ? `?orgId=${encodeURIComponent(orgId)}` : "";
    void fetch(`/api/district-advancement${query}`)
      .then(async (response) => {
        const data = (await response.json()) as TrajectoryView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError(
            "error" in data && data.error ? data.error : "Could not load district advancement.",
          );
          setErrorStatus(response.status);
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
  // Retry cannot fix an expired session — offer the action that can.
  const failure = error
    ? loadFailureCopy(
        classifyLoadFailure({
          status: errorStatus,
          message: error,
          online: typeof navigator === "undefined" ? true : navigator.onLine,
        }),
        {
          nextPath:
            typeof window === "undefined"
              ? null
              : `${window.location.pathname}${window.location.search}`,
          message: error,
        },
      )
    : null;

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
      {failure ? (
        <>
          <p className="app-muted">
            <strong>{failure.title}</strong> {failure.description}
          </p>
          {failure.primary ? (
            <p>
              <a className="app-button" href={failure.primary.href}>
                {failure.primary.label}
              </a>
            </p>
          ) : null}
          {failure.showRetry ? (
            <p>
              <button type="button" className="app-button secondary" onClick={() => load()}>
                Retry
              </button>
            </p>
          ) : null}
        </>
      ) : null}
      {!view && !failure ? <p className="app-muted">Loading…</p> : null}
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
