"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, PageHeader, Panel, Button } from "../../components/ui";
import type { TrajectoryView } from "../../lib/district-trajectory-sim/compute-district-trajectory-sim";
import { hubHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { withOrgHref } from "../../lib/nav/product-nav";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

type LiveView = Extract<TrajectoryView, { status: "live" }>;

function isTrajectoryView(value: unknown): value is TrajectoryView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

function responseError(data: unknown): string {
  return data && typeof data === "object" && "error" in data && typeof data.error === "string"
    ? data.error
    : "";
}

function districtAdvancementCacheOrg(data: TrajectoryView, orgHint: string): string {
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

async function persistDistrictAdvancementSnapshot(
  orgHint: string,
  seasonHint: string,
  data: TrajectoryView,
): Promise<void> {
  const cacheOrg = districtAdvancementCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  const seasonKey = data.status === "live" ? String(data.seasonYear) : seasonHint;
  try {
    await putFeatureSnapshot("district-advancement", cacheOrg, data, seasonHint || seasonKey);
    if (!orgHint) await putFeatureSnapshot("district-advancement", "_", data, seasonHint || seasonKey);
  } catch {
    // Live District advancement already painted; IndexedDB is best-effort.
  }
}

function DistrictAdvancementRelated({ orgId }: { orgId?: string | null }) {
  return (
    <nav className="product-hub-related" aria-label="Related competition tools">
      <Button as="a" variant="secondary" href={hubHref("/competition", "ranking-projection", orgId)}>
        Rank projection
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/business", "mock-judging", orgId)}>
        Mock judging
      </Button>
      <Button as="a" variant="secondary" href={withOrgHref("/strategy", orgId)}>
        Strategy
      </Button>
    </nav>
  );
}

function DistrictAdvancementNextActions({ orgId }: { orgId: string }) {
  const actions = [
    {
      id: "strategy",
      label: "Open Strategy",
      detail: "Alliance plans and remaining-event picks live on Strategy.",
      href: withOrgHref("/strategy", orgId),
      primary: true,
    },
    {
      id: "rank",
      label: "Open Rank projection",
      detail: "Event ranking uses the same cached scores as this district board.",
      href: hubHref("/competition", "ranking-projection", orgId),
      primary: false,
    },
    {
      id: "mock",
      label: "Open Mock judging",
      detail: "Practice award interviews stay on this phone when venue Wi-Fi drops.",
      href: hubHref("/business", "mock-judging", orgId),
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

export default function DistrictAdvancementClient() {
  const [view, setView] = useState<TrajectoryView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [failureStatus, setFailureStatus] = useState<number | null>(null);
  const [failureMessage, setFailureMessage] = useState("");
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<TrajectoryView | null>(null);
  viewRef.current = view;

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback(async () => {
    const params = new URLSearchParams(window.location.search);
    const orgHint = params.get("orgId")?.trim() ?? "";
    const seasonHint = String(new Date().getFullYear());
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<TrajectoryView>(
        "district-advancement",
        orgHint || "_",
        seasonHint,
      );
      if (!viewRef.current && cached?.data && isTrajectoryView(cached.data)) {
        setView(cached.data);
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
      const response = await fetch(
        `/api/district-advancement${query.toString() ? `?${query.toString()}` : ""}`,
        {
          cache: "no-store",
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        },
      );
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
      if (!response.ok || !isTrajectoryView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh District advancement. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setFetchFailed(true);
        setFailureStatus(response.status);
        setFailureMessage(responseError(data));
        return;
      }
      setView(data);
      setFromCache(false);
      setCachedAt(null);
      await persistDistrictAdvancementSnapshot(orgHint, seasonHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setError("Could not refresh District advancement. Showing the last copy on this device.");
        setFetchFailed(false);
        return;
      }
      setFetchFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const competitionHref = orgId ? `/competition?orgId=${encodeURIComponent(orgId)}` : "/competition";
  const header = (
    <PageHeader
      breadcrumbs={
        <>
          <a href={competitionHref}>Competition</a>
          {" / District advancement"}
        </>
      }
      title="District advancement"
      description="Project remaining district points from cached scores and the remaining event list."
    >
      <DistrictAdvancementRelated orgId={orgId} />
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
        <OfflineBanner feature="District advancement" fromCache={fromCache} cachedAt={cachedAt} />
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
          <OfflineBanner feature="District advancement" fromCache={fromCache} cachedAt={cachedAt} />
          {error ? (
            <p className="telemetry-status" role="alert">
              {error}
            </p>
          ) : null}
          <EmptyState badge="Setup required" badgeTone="setup" title="Not enough district data yet" description={view.message}>
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
      <OfflineBanner feature="District advancement" fromCache={fromCache} cachedAt={cachedAt} />
      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}
      <DistrictAdvancementNextActions orgId={view.orgId} />
      <LiveDistrictBoard view={view} />
    </main>
  );
}

function LiveDistrictBoard({ view }: { view: LiveView }) {
  return (
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
    </Panel>
  );
}
