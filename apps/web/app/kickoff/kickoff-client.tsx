"use client";

import { packForYear } from "@vantage/game-year";
import { useCallback, useEffect, useRef, useState } from "react";
import { BuildHubRelated } from "../../components/build-hub-related";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, PageHeader, Button } from "../../components/ui";
import { kickoffSummary, type KickoffView } from "../../lib/kickoff";
import { KICKOFF_BUILD_RELATED_INCLUDE, shouldShowKickoffSummaryTiles } from "../../lib/kickoff-related";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { NextActionsPanel, useHubEmbed } from "./kickoff-chrome";
import { IntelligenceSection } from "./kickoff-intelligence";
import type { ActionBody } from "./kickoff-model";
import { PrioritySection } from "./kickoff-priority";
import { RulesSection } from "./kickoff-rules";
import { ScoringSection } from "./kickoff-scoring";

function isKickoffView(value: unknown): value is KickoffView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "ready";
}

function kickoffCacheOrg(data: KickoffView, orgHint: string): string {
  return data.context.orgId?.trim() || orgHint;
}

async function persistKickoffSnapshot(orgHint: string, data: KickoffView): Promise<void> {
  const cacheOrg = kickoffCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("kickoff", cacheOrg, data);
    if (!orgHint) await putFeatureSnapshot("kickoff", "_", data);
  } catch {
    // Live Kickoff already painted; IndexedDB is best-effort.
  }
}

export default function KickoffClient(_props: { embedded?: boolean } = {}) {
  const embed = useHubEmbed();
  const [view, setView] = useState<KickoffView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [cutoffCode, setCutoffCode] = useState<string | null>(null);
  const [hasIntelligence, setHasIntelligence] = useState(false);
  const [cadJobId, setCadJobId] = useState<string | null>(null);

  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<KickoffView | null>(null);
  viewRef.current = view;

  const crumbs = embed === "build" ? "Build / Kickoff" : "Season / Kickoff";

  const load = useCallback(async () => {
    const params = new URLSearchParams(window.location.search);
    const orgHint = params.get("orgId")?.trim() ?? "";
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<KickoffView>("kickoff", orgHint || "_");
      if (!viewRef.current && cached?.data && isKickoffView(cached.data)) {
        setView(cached.data);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        hadCache = true;
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    setFetchFailed(false);
    setErrorStatus(null);
    try {
      const response = await fetch(`/api/kickoff${orgHint ? `?orgId=${encodeURIComponent(orgHint)}` : ""}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data = (await response.json()) as KickoffView | { error?: string };
      if (!response.ok || !isKickoffView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Kickoff. Showing the last copy on this device.");
          setFetchFailed(false);
        } else {
          setError("error" in data && data.error ? data.error : "Could not load kickoff analysis.");
          setErrorStatus(response.status);
          setFetchFailed(true);
        }
        return;
      }
      setError("");
      setView(data);
      setFromCache(false);
      setCachedAt(null);
      await persistKickoffSnapshot(orgHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setError("Could not refresh Kickoff. Showing the last copy on this device.");
        setFetchFailed(false);
      } else {
        setFetchFailed(true);
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onIntelMeta = useCallback((meta: { hasIntelligence: boolean; cadJobId: string | null }) => {
    setHasIntelligence(meta.hasIntelligence);
    setCadJobId(meta.cadJobId);
  }, []);

  const run = useCallback(
    async (body: ActionBody, key: string) => {
      setBusyKey(key);
      setError("");
      try {
        const response = await fetch("/api/kickoff", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data = (await response.json()) as { error?: string };
        if (!response.ok) {
          setError(data.error ?? "Action failed.");
          return;
        }
        await load();
      } catch {
        setError("Network error — changes were not saved.");
      } finally {
        setBusyKey(null);
      }
    },
    [load],
  );

  if (!view) {
    const failure = fetchFailed
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
            message: error || "Check your connection and try again.",
          },
        )
      : null;
    return (
      <main className="module-page kick-page">
        <PageHeader breadcrumbs={crumbs} title="Kickoff" />
        <OfflineBanner feature="Kickoff" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          soft
          title={failure ? failure.title : "Opening Kickoff"}
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

  if (view.status === "setup_required") {
    return (
      <main className="module-page kick-page">
        <PageHeader
          breadcrumbs={crumbs}
          title="Kickoff"
          description="Break the new game into scoring actions, rank them by value, and lock the design priorities."
        />
        <BuildHubRelated active="kickoff" include={[...KICKOFF_BUILD_RELATED_INCLUDE]} />
        <OfflineBanner feature="Kickoff" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState badge="Needs setup" badgeTone="setup" soft title="Choose your team" description={view.message}>
          <Button as="a" variant="primary" href="/workspace">
            Choose your team
          </Button>
        </EmptyState>
      </main>
    );
  }

  const orgId = view.context.orgId ?? "";
  const yearSet = new Set<number>([view.context.defaultSeasonYear]);
  for (const entry of view.actions) yearSet.add(entry.seasonYear);
  for (const entry of view.priorities) yearSet.add(entry.seasonYear);
  for (const entry of view.ruleNotes) yearSet.add(entry.seasonYear);
  const years = [...yearSet].sort((a, b) => b - a);
  const year = selectedYear != null && yearSet.has(selectedYear) ? selectedYear : view.context.defaultSeasonYear;
  const actions = view.actions.filter((entry) => entry.seasonYear === year);
  const priorities = view.priorities.filter((entry) => entry.seasonYear === year);
  const ruleNotes = view.ruleNotes.filter((entry) => entry.seasonYear === year);
  const summary = kickoffSummary(actions, priorities, ruleNotes);
  const showTiles = shouldShowKickoffSummaryTiles(summary);

  return (
    <main className="module-page kick-page">
      <PageHeader
        breadcrumbs={crumbs}
        title="Kickoff"
        description={
          <>
            Start from the {year} manual and kickoff transcript for {view.context.orgName ?? "your team"}
            {view.context.teamNumber ? ` (Team ${view.context.teamNumber})` : ""} — structure the game, seed Strategy
            priorities, and hand a CAD brief to Onshape/Fusion paths.
          </>
        }
      >
        <label className="kick-year">
          Season
          <select value={year} disabled={busyKey != null} onChange={(event) => setSelectedYear(Number(event.target.value))}>
            {years.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      </PageHeader>

      <BuildHubRelated orgId={orgId} active="kickoff" include={[...KICKOFF_BUILD_RELATED_INCLUDE]} />
      <OfflineBanner feature="Kickoff" fromCache={fromCache} cachedAt={cachedAt} />
      {(() => {
        const pack = packForYear(year);
        return (
          <p className="app-muted" role="status">
            {pack.gameName} {pack.year}
            {pack.status === "awaiting_manual"
              ? " — scoring keys stay empty until the official manual publishes."
              : " — scoring keys come from the official manual."}
          </p>
        );
      })()}

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      <NextActionsPanel
        orgId={orgId}
        seasonYear={year}
        hasIntelligence={hasIntelligence}
        actionCount={actions.length}
        priorityCount={priorities.length}
        openRuleCount={summary.openQuestions}
        cadJobId={cadJobId}
      />

      {showTiles ? (
        <section className="kick-tiles">
          <div className="app-card kick-tile soft-panel">
            <span className="kick-tile-value">{summary.actions}</span>
            <span className="kick-tile-label">Actions analyzed</span>
          </div>
          <div className="app-card kick-tile soft-panel">
            <span className="kick-tile-value kick-tile-best">{summary.bestAction ?? "—"}</span>
            <span className="kick-tile-label">Best value action</span>
          </div>
          <div className="app-card kick-tile soft-panel">
            <span className="kick-tile-value">{summary.committed}</span>
            <span className="kick-tile-label">Committed priorities</span>
          </div>
          <div className="app-card kick-tile soft-panel">
            <span className="kick-tile-value">{summary.openQuestions}</span>
            <span className="kick-tile-label">Open rules questions</span>
          </div>
        </section>
      ) : null}

      <IntelligenceSection
        orgId={orgId}
        seasonYear={year}
        busyKey={busyKey}
        setBusyKey={setBusyKey}
        setError={setError}
        cutoffCode={cutoffCode}
        setCutoffCode={setCutoffCode}
        onIntelMeta={onIntelMeta}
        onApplied={load}
      />
      <ScoringSection actions={actions} orgId={orgId} seasonYear={year} busyKey={busyKey} run={run} />
      <PrioritySection priorities={priorities} actions={actions} orgId={orgId} seasonYear={year} busyKey={busyKey} run={run} />
      <RulesSection ruleNotes={ruleNotes} orgId={orgId} seasonYear={year} busyKey={busyKey} run={run} />
    </main>
  );
}
