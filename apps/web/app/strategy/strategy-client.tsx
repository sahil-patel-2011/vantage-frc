"use client";

import { useCallback, useEffect, useState } from "react";
import { DataSourceDegradedBanner } from "../../components/data-source-degraded-banner";
import { OfflineBanner } from "../../components/offline-banner";
import { PageHeader, ToolStrip, Button } from "../../components/ui";
import { CopyShareLink } from "../../components/copy-share-link";
import { useVenueShortcuts, VenueShortcutCheatsheet } from "../../hooks/use-venue-shortcuts";
import { withOrgHref } from "../../lib/nav/product-nav";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import {
  classifyStrategyShell,
  strategyNextActions,
  strategyShellSetupSteps,
} from "../../lib/strategy/strategy-related";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import type { StrategyView } from "../../lib/strategy/types";
import { PickListWorkbench } from "./pick-list-workbench";
import {
  StrategyNextActionsPanel,
  StrategyRelatedStrip,
  StrategyShell,
  TbaKeyHint,
  type StrategyTab,
} from "./strategy-chrome";
import { LivePanel } from "./strategy-live-panel";
import "./strategy.css";

export default function StrategyClient({ embedded = false }: { embedded?: boolean } = {}) {
  const [view, setView] = useState<StrategyView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<StrategyTab>("matchup");
  const [urlOrgId, setUrlOrgId] = useState<string | null>(null);
  const [recomputing, setRecomputing] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const previewOrgId = (view && "orgId" in view ? view.orgId : null) ?? urlOrgId;
  const { cheatOpen, setCheatOpen, shortcuts } = useVenueShortcuts(previewOrgId);

  useEffect(() => {
    setUrlOrgId(new URLSearchParams(window.location.search).get("orgId"));
  }, []);

  const loadStrategy = useCallback(() => {
    setFetchFailed(false);
    setError("");
    setLoading(true);
    const params = new URLSearchParams(window.location.search);
    const orgId = params.get("orgId");
    const requestedTab = params.get("tab");
    if (requestedTab === "picks") setTab("picks");
    void fetch(`/api/strategy${orgId ? `?orgId=${encodeURIComponent(orgId)}` : ""}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
    })
      .then(async (response) => {
        const data = (await response.json()) as StrategyView | { error?: string };
        if (!response.ok || !("status" in data)) {
          const message = "error" in data ? data.error : undefined;
          if (orgId) {
            const row = await getFeatureSnapshot<StrategyView>("strategy", orgId);
            if (row) {
              setView(row.data);
              setFromCache(true);
              setCachedAt(row.cachedAt);
              return;
            }
          }
          if (!message) {
            setFetchFailed(true);
            setView(null);
            return;
          }
          setError(message);
          setView({
            status: "setup_required",
            message: "Choose your team before running win/loss strategy.",
            steps: strategyShellSetupSteps(null).map((step) => ({
              id: step.id,
              label: step.label,
              detail: step.detail,
              href: step.href,
            })),
            orgId: null,
            eventKey: null,
            eventName: null,
            teamNumber: null,
            tbaConfigured: false,
          });
          return;
        }
        setView(data);
        setFromCache(false);
        setCachedAt(new Date().toISOString());
        const persistOrg = "orgId" in data && data.orgId ? data.orgId : orgId;
        if (persistOrg) await putFeatureSnapshot("strategy", persistOrg, data);
      })
      .catch(async () => {
        if (orgId) {
          const row = await getFeatureSnapshot<StrategyView>("strategy", orgId);
          if (row) {
            setView(row.data);
            setFromCache(true);
            setCachedAt(row.cachedAt);
            return;
          }
        }
        setFetchFailed(true);
        setView(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    loadStrategy();
  }, [loadStrategy]);

  const recomputePrediction = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    const orgId = params.get("orgId");
    const matchKey =
      view && view.status === "live" && typeof view.matchKey === "string"
        ? view.matchKey
        : params.get("matchKey");
    setRecomputing(true);
    setError("");
    void fetch("/api/strategy", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "recompute", orgId, matchKey }),
      signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
    })
      .then(async (response) => {
        const data = (await response.json()) as StrategyView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError(("error" in data && data.error) || "Could not recompute this prediction.");
          return;
        }
        setView(data);
      })
      .catch(() => {
        setError("Could not recompute this prediction.");
      })
      .finally(() => {
        setRecomputing(false);
      });
  }, [view]);

  const orgId = view && "orgId" in view ? view.orgId : null;
  const shell = classifyStrategyShell({
    loading,
    fetchFailed,
    status: view?.status ?? null,
    orgId,
  });

  if (tab !== "picks" && shell !== "ready") {
    return (
      <StrategyShell orgId={orgId} shell={shell} error={error || undefined} onRetry={loadStrategy} embedded={embedded} fromCache={fromCache} cachedAt={cachedAt}>
        {error && shell !== "error" ? (
          <p className="telemetry-status" role="alert">
            {error}
          </p>
        ) : null}
      </StrategyShell>
    );
  }

  const nextActions =
    view && view.status === "live"
      ? strategyNextActions({
          orgId: view.orgId,
          shell: "ready",
          eventKey: view.eventKey,
          tbaConfigured: view.tbaConfigured ?? view.tbaAccess?.tbaConfigured,
          hasMetrics: view.referenceAccess?.statbotics.cacheHasMetrics,
        })
      : strategyNextActions({
          orgId,
          shell: shell === "ready" ? "ready" : shell,
          eventKey: view && "eventKey" in view ? view.eventKey : null,
          tbaConfigured: view?.tbaConfigured ?? view?.tbaAccess?.tbaConfigured,
          hasMetrics: view?.referenceAccess?.statbotics.cacheHasMetrics,
        });

  return (
    <main className={`module-page strategy-page${embedded ? " is-embedded" : ""}`}>
      {embedded ? null : (
      <PageHeader
        breadcrumbs="Competition / Strategy"
        title="Strategy"
        description="Win/loss and pick lists use synced event numbers and your scout notes."
      >
        <div className="strategy-header-actions">
          <StrategyRelatedStrip orgId={orgId} />
          <CopyShareLink orgId={orgId} />
          <Button variant="secondary" type="button" onClick={() => window.print()}>
            Print
          </Button>
          <Button variant="primary" type="button" disabled={recomputing || loading} onClick={() => void recomputePrediction()}>
            {recomputing ? "Recomputing…" : "Recompute prediction"}
          </Button>
          {orgId ? (
            <>
              <Button as="a" variant="secondary" href={withOrgHref("/strategy/draft", orgId)}>
                Draft board
              </Button>
              <Button as="a" variant="secondary"
                href={withOrgHref("/exports?domains=pick-lists,reference-metrics,research", orgId)}
              >
                Export
              </Button>
              <Button as="a" variant="secondary" href={withOrgHref("/team/data", orgId)}>
                Team data
              </Button>
            </>
          ) : null}
          {view?.status === "live" ? (
            <span className={`app-badge ${view.dataSourceHealth?.degraded ? "setup" : "good"}`}>
              {view.dataSourceHealth?.usingLastGoodCache ? "Last-good cache" : "Live inputs"}
            </span>
          ) : null}
        </div>
      </PageHeader>
      )}
      <OfflineBanner feature="Strategy" fromCache={fromCache} cachedAt={cachedAt} />
      <VenueShortcutCheatsheet open={cheatOpen} onClose={() => setCheatOpen(false)} shortcuts={shortcuts} />

      <ToolStrip
        aria-label="Strategy sections"
        value={tab}
        onChange={(id) => setTab(id as StrategyTab)}
        items={[
          { id: "matchup", label: "Matchup" },
          { id: "picks", label: "Pick lists" },
        ]}
      />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      <DataSourceDegradedBanner health={view?.dataSourceHealth} />

      {view ? <TbaKeyHint view={view} /> : null}

      {tab === "picks" ? (
        <PickListWorkbench orgId={orgId} embedded />
      ) : view?.status === "live" ? (
        <>
          <LivePanel view={view} />
          {embedded ? null : <StrategyNextActionsPanel actions={nextActions} />}
        </>
      ) : null}
    </main>
  );
}
