"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DataSourceDegradedBanner } from "../../components/data-source-degraded-banner";
import { OfflineBanner } from "../../components/offline-banner";
import { PageHeader, ToolStrip, Button } from "../../components/ui";
import { CopyShareLink } from "../../components/copy-share-link";
import { useVenueShortcuts, VenueShortcutCheatsheet } from "../../hooks/use-venue-shortcuts";
import { withOrgHref } from "../../lib/nav/product-nav";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import {
  classifyStrategyShell,
  strategyCanSync,
  strategyNextActions,
  strategyShellSetupSteps,
} from "../../lib/strategy/strategy-related";
import { clearFeatureSnapshot, getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import type { StrategyView } from "../../lib/strategy/types";
import { PickListWorkbench } from "./pick-list-workbench";
import {
  StrategyBriefingCard,
  StrategyNextActionsPanel,
  StrategyRelatedStrip,
  StrategyShell,
  TbaKeyHint,
  type StrategyTab,
} from "./strategy-chrome";
import { LivePanel } from "./strategy-live-panel";
import { URL_CHANGE_EVENT } from "../../lib/nav/url-change";
import "./strategy.css";
import { StrategyMatchPicker } from "./strategy-match-picker";

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
  const viewRef = useRef<StrategyView | null>(null);
  viewRef.current = view;
  const previewOrgId = (view && "orgId" in view ? view.orgId : null) ?? urlOrgId;
  const { cheatOpen, setCheatOpen, shortcuts } = useVenueShortcuts(previewOrgId);

  useEffect(() => {
    setUrlOrgId(new URLSearchParams(window.location.search).get("orgId"));
  }, []);

  const loadedMatchKeyRef = useRef("");
  const loadStrategyRef = useRef<(() => void) | null>(null);

  // "Pick desk" links here from the hub's own tool strip, which does not remount this page:
  // follow the view named in the address when it changes.
  useEffect(() => {
    const follow = () => {
      const params = new URLSearchParams(window.location.search);
      const requested = params.get("sub") ?? (params.get("tab") === "picks" ? "picks" : null);
      if (requested === "picks") setTab("picks");
      // A match chip changes ?matchKey= on this same page: load that match.
      if ((params.get("matchKey") ?? "") !== loadedMatchKeyRef.current) loadStrategyRef.current?.();
    };
    window.addEventListener(URL_CHANGE_EVENT, follow);
    window.addEventListener("popstate", follow);
    return () => {
      window.removeEventListener(URL_CHANGE_EVENT, follow);
      window.removeEventListener("popstate", follow);
    };
  }, []);

  const loadStrategy = useCallback(() => {
    void (async () => {
      const params = new URLSearchParams(window.location.search);
      const orgId = params.get("orgId");
      // The match named in the address (a chip, the briefing's link); otherwise our next one.
      const requestedMatch = params.get("matchKey") ?? "";
      loadedMatchKeyRef.current = requestedMatch;
      const cacheOrg = orgId?.trim() || "_";
      // Embedded in the competition hub, `tab` is spent on the hub's own tab
      // ("strategy"), so the pick desk arrives as `sub`. Standalone, it is
      // still `tab`. Read the specific one first.
      const requestedTab = params.get("sub") ?? params.get("tab");
      if (requestedTab === "picks") setTab("picks");
      let hadCache = Boolean(viewRef.current);
      try {
        const cached = await getFeatureSnapshot<StrategyView>("strategy", cacheOrg);
        if (!viewRef.current && cached?.data && "status" in cached.data) {
          setView(cached.data);
          setFromCache(true);
          setCachedAt(cached.cachedAt);
          setLoading(false);
          hadCache = true;
        }
      } catch {
        // IndexedDB missing or blocked; live fetch still runs.
      }
      setFetchFailed(false);
      setError("");
      try {
        const query = new URLSearchParams();
        if (orgId) query.set("orgId", orgId);
        if (requestedMatch) query.set("matchKey", requestedMatch);
        const response = await fetch(`/api/strategy${query.size ? `?${query.toString()}` : ""}`, {
          cache: "no-store",
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data = (await response.json()) as StrategyView | { error?: string };
        if (response.status === 401 || response.status === 403) {
          setView(null);
          setFromCache(false);
          setCachedAt(null);
          setFetchFailed(true);
          void clearFeatureSnapshot("strategy", cacheOrg);
          if (orgId) void clearFeatureSnapshot("strategy", orgId);
          return;
        }
        if (!response.ok || !("status" in data)) {
          if (hadCache || viewRef.current) {
            setFromCache(true);
            setError("Could not refresh Strategy. Showing the last copy on this device.");
            setFetchFailed(false);
            return;
          }
          const message = "error" in data ? data.error : undefined;
          if (!message) {
            setFetchFailed(true);
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
        const persistOrg = "orgId" in data && data.orgId ? data.orgId : cacheOrg;
        try {
          await putFeatureSnapshot("strategy", persistOrg, data);
          if (!orgId) await putFeatureSnapshot("strategy", "_", data);
        } catch {
          // Live Strategy already painted; IndexedDB is best-effort.
        }
      } catch {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Strategy. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setFetchFailed(true);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    loadStrategyRef.current = loadStrategy;
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
  const eventName = view && "eventName" in view ? view.eventName : null;
  const actorRole = view && "actorRole" in view ? view.actorRole : undefined;
  const canSync = strategyCanSync(actorRole);
  const shell = classifyStrategyShell({
    loading,
    fetchFailed,
    status: view?.status ?? null,
    orgId,
  });

  const sectionTabs = (
    <ToolStrip
      aria-label="Strategy sections"
      value={tab}
      onChange={(id) => setTab(id as StrategyTab)}
      items={[
        { id: "matchup", label: "Matchup" },
        { id: "picks", label: "Pick lists" },
      ]}
    />
  );

  if (tab !== "picks" && shell !== "ready") {
    return (
      <StrategyShell
        orgId={orgId}
        shell={shell}
        error={error || undefined}
        onRetry={loadStrategy}
        embedded={embedded}
        fromCache={fromCache}
        cachedAt={cachedAt}
        eventName={eventName}
        lastMatch={view && view.status !== "live" ? view.lastMatch ?? null : null}
      >
        {/* The switcher has to survive this state. Without it, clicking Matchup
            before there is a matchup to show replaced the whole panel — tabs
            included — and the only way back to the pick list was to edit the
            URL, mid-alliance-selection. */}
        {sectionTabs}
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
              {actorRole != null && strategyCanSync(actorRole) ? (
                <Button as="a" variant="secondary" href={withOrgHref("/team/data", orgId)}>
                  Team data
                </Button>
              ) : null}
            </>
          ) : null}
          {view?.status === "live" ? (
            <span className={`app-badge ${view.dataSourceHealth?.degraded ? "setup" : "good"}`}>
              {view.dataSourceHealth?.usingLastGoodCache ? "Last saved data" : "Up to date"}
            </span>
          ) : null}
        </div>
      </PageHeader>
      )}
      <OfflineBanner feature="Strategy" fromCache={fromCache} cachedAt={cachedAt} />
      <VenueShortcutCheatsheet open={cheatOpen} onClose={() => setCheatOpen(false)} shortcuts={shortcuts} />

      {sectionTabs}

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      <DataSourceDegradedBanner health={view?.dataSourceHealth} canOpenTeamData={canSync} />

      {view ? <TbaKeyHint view={view} /> : null}

      {tab === "picks" ? (
        <PickListWorkbench orgId={orgId} embedded />
      ) : view?.status === "live" ? (
        <>
          <StrategyMatchPicker orgId={view.orgId} current={view.matchKey} />
          {/* The chance to win first; the briefing link after it (it pushed the answer off a phone's first screen). */}
          <LivePanel view={view} />
          <StrategyBriefingCard
            orgId={view.orgId}
            matchKey={view.matchKey}
            compLevel={view.compLevel}
            matchNumber={view.matchNumber}
          />
          {embedded ? null : <StrategyNextActionsPanel actions={nextActions} />}
        </>
      ) : null}
    </main>
  );
}
