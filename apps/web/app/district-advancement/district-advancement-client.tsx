"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, PageHeader, Panel, Button } from "../../components/ui";
import type { TrajectoryView } from "../../lib/district-trajectory-sim/compute-district-trajectory-sim";
import { withOrgHref } from "../../lib/nav/product-nav";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

export default function DistrictAdvancementClient() {
  const [view, setView] = useState<TrajectoryView | null>(null);
  const [error, setError] = useState("");
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
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
          setErrorStatus(response.status);
          setError(
            "error" in data && data.error ? data.error : "Could not load district advancement.",
          );
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
  // Retry cannot fix an expired session, so the failure decides its own action.
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
        description="Project remaining district points from cached EPA and the remaining event list."
      />
      {failure ? (
        <EmptyState title={failure.title} description={failure.description}>
          {failure.primary ? (
            <Button as="a" variant="primary" href={failure.primary.href}>
              {failure.primary.label}
            </Button>
          ) : null}
          {failure.showRetry ? (
            <Button variant="secondary" type="button" onClick={() => load()}>
              Retry
            </Button>
          ) : null}
        </EmptyState>
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
            <Button as="a" variant="secondary" href={withOrgHref("/strategy", view.orgId)}>
              Open Strategy
            </Button>
          </p>
        </Panel>
      ) : null}
    </main>
  );
}
