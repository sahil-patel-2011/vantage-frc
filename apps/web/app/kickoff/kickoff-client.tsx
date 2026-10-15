"use client";

import { availableSeasonYears, currentSeasonYear, lastPublishedPack, packForYear } from "@vantage/game-year";
import { useCallback, useEffect, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, PageHeader, Button, TabBar } from "../../components/ui";
import { kickoffSummary, type KickoffView } from "../../lib/kickoff";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { useHubEmbed } from "./kickoff-chrome";
import { IntelligenceSection, prefetchKickoffIntelligence, type KickoffIntelPrefetch } from "./kickoff-intelligence";
import type { ActionBody } from "./kickoff-model";
import { PrioritySection } from "./kickoff-priority";
import { NextSeasonSection } from "./kickoff-next-season";
import { RulesSection } from "./kickoff-rules";
import { GameBriefSection } from "./kickoff-game-brief";
import { ScoringSection } from "./kickoff-scoring";
import { teamProseLabel } from "../../components/app-shell-model";

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

type KickoffSection = "overview" | "scoring" | "priorities" | "rules" | "next";

export default function KickoffClient({ embedded = false }: { embedded?: boolean } = {}) {
  const embed = useHubEmbed();
  const Root = embedded || embed === "build" ? "section" : "main";
  const [view, setView] = useState<KickoffView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [section, setSection] = useState<KickoffSection>("overview");
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [cutoffCode, setCutoffCode] = useState<string | null>(null);
  const [intelPrefetch, setIntelPrefetch] = useState<KickoffIntelPrefetch | null>(null);
  const intelPrefetchStarted = useRef(false);

  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<KickoffView | null>(null);
  viewRef.current = view;

  const crumbs = embed === "build" ? "Build / Kickoff" : "Season / Kickoff";

  const load = useCallback(async () => {
    const params = new URLSearchParams(window.location.search);
    const orgHint = params.get("orgId")?.trim() ?? "";
    let hadCache = Boolean(viewRef.current);
    if (!intelPrefetchStarted.current) {
      // The intelligence section used to wait for this view before it asked for its own data.
      // Start its read now, for the season the view opens on (the route defaults to it too).
      intelPrefetchStarted.current = true;
      setIntelPrefetch(prefetchKickoffIntelligence(orgHint, currentSeasonYear()));
    }
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
      <Root className="module-page kick-page">
        <PageHeader breadcrumbs={crumbs} title="Kickoff & Game Analysis" />
        <OfflineBanner feature="Kickoff" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          soft
          title={failure ? failure.title : "Loading kickoff analysis…"}
          description={failure ? failure.description : undefined}
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
      </Root>
    );
  }

  if (view.status === "setup_required") {
    return (
      <Root className="module-page kick-page">
        <PageHeader
          breadcrumbs={crumbs}
          title="Kickoff & Game Analysis"
          description="Break the new game into scoring actions, rank them by value, and lock the design priorities."
        />
        <OfflineBanner feature="Kickoff" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState badge="Needs setup" badgeTone="setup" soft title="Choose your team" description={view.message}>
          <Button as="a" variant="primary" href="/workspace">
            Choose your team
          </Button>
        </EmptyState>
      </Root>
    );
  }

  const orgId = view.context.orgId ?? "";
  const yearSet = new Set<number>(availableSeasonYears([view.context.defaultSeasonYear]));
  const prior = lastPublishedPack();
  if (prior) yearSet.add(prior.year);
  for (const entry of view.actions) yearSet.add(entry.seasonYear);
  for (const entry of view.priorities) yearSet.add(entry.seasonYear);
  for (const entry of view.ruleNotes) yearSet.add(entry.seasonYear);
  const years = [...yearSet].sort((a, b) => b - a);
  const year = selectedYear != null && yearSet.has(selectedYear) ? selectedYear : view.context.defaultSeasonYear;
  const actions = view.actions.filter((entry) => entry.seasonYear === year);
  const priorities = view.priorities.filter((entry) => entry.seasonYear === year);
  const ruleNotes = view.ruleNotes.filter((entry) => entry.seasonYear === year);
  const summary = kickoffSummary(actions, priorities, ruleNotes);
  // Next-season notes are not filtered by the year picker: they are about the
  // season after this one, and there is only ever one of those to look at.
  const nextSeasonSignals = view.nextSeasonSignals ?? [];
  const seasonControl = (
    <label className="kick-year">
      Season
      <select value={year} disabled={busyKey != null} onChange={(event) => setSelectedYear(Number(event.target.value))}>
        {years.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );

  return (
    <Root className="module-page kick-page">
      <PageHeader
        breadcrumbs={crumbs}
        title="Kickoff"
        description={
          <>
            Read the {year} game for {teamProseLabel(view.context.teamNumber, view.context.orgName) ?? "your team"}: what scores, what to build first,
            and which rules to check.
          </>
        }
      >
        {embedded || embed === "build" ? null : seasonControl}
      </PageHeader>
      {embedded || embed === "build" ? <div className="kick-embedded-controls">{seasonControl}</div> : null}

      <OfflineBanner feature="Kickoff" fromCache={fromCache} cachedAt={cachedAt} />
      {/*
        This line used to be visible, and it said what the card directly below
        it says: the game name and year are that card's heading, "from the
        published manual" is its badge, "scoring on the sheet" is its next
        paragraph, and "last season is below" is the heading of its last
        section. On a phone it pushed the card it was describing down by a line
        and read as a caption for nothing.

        It stays in the accessibility tree because it is the live region that
        announces a change from the season picker in the header — the card
        re-renders silently otherwise.
      */}
      {(() => {
        const pack = packForYear(year);
        return (
          <p className="visually-hidden" role="status">
            {pack.gameName} {pack.year}
            {pack.status === "awaiting_manual"
              ? " — official scoring is not published yet. Last season is below so you can still practice."
              : " — scoring on the sheet comes from the published manual."}
          </p>
        );
      })()}

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {/* One page per question instead of ten stacked cards: the counts that used to be four
          tiles are on the tabs, and the Next actions card (links to these same sections and to
          Strategy and CAD) is gone. */}
      <TabBar
        tabs={[
          { id: "overview", label: "Overview" },
          { id: "scoring", label: summary.actions ? `Scoring · ${summary.actions}` : "Scoring" },
          { id: "priorities", label: priorities.length ? `Priorities · ${priorities.length}` : "Priorities" },
          { id: "rules", label: summary.openQuestions ? `Rules · ${summary.openQuestions} open` : "Rules" },
          { id: "next", label: "Next season" },
        ]}
        value={section}
        onChange={(id) => setSection(id as KickoffSection)}
        aria-label="Kickoff"
        panelId="kick-section"
        className="kick-tabs"
      />
      <div id="kick-section" role="tabpanel">
        {section === "overview" ? (
          <>
            <GameBriefSection orgId={orgId} seasonYear={year} />
            <IntelligenceSection
              orgId={orgId}
              seasonYear={year}
              busyKey={busyKey}
              setBusyKey={setBusyKey}
              setError={setError}
              cutoffCode={cutoffCode}
              setCutoffCode={setCutoffCode}
              onApplied={load}
              prefetch={intelPrefetch}
            />
          </>
        ) : null}
        {section === "scoring" ? (
          <ScoringSection
            actions={actions}
            orgId={orgId}
            seasonYear={year}
            role={view.context.role}
            userId={view.context.userId}
            busyKey={busyKey}
            run={run}
          />
        ) : null}
        {section === "priorities" ? (
          <PrioritySection
            priorities={priorities}
            actions={actions}
            orgId={orgId}
            seasonYear={year}
            role={view.context.role}
            userId={view.context.userId}
            busyKey={busyKey}
            run={run}
          />
        ) : null}
        {section === "rules" ? (
          <RulesSection
            ruleNotes={ruleNotes}
            orgId={orgId}
            seasonYear={year}
            role={view.context.role}
            userId={view.context.userId}
            busyKey={busyKey}
            run={run}
          />
        ) : null}
        {section === "next" ? (
          <NextSeasonSection
            signals={nextSeasonSignals}
            orgId={orgId}
            seasonYear={year + 1}
            busyKey={busyKey}
            run={run}
          />
        ) : null}
      </div>
    </Root>
  );
}
