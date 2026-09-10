"use client";

import { packForYear } from "@vantage/game-year";
import { useCallback, useEffect, useState } from "react";
import { BuildHubRelated } from "../../components/build-hub-related";
import { EmptyState, PageHeader, Button } from "../../components/ui";
import { kickoffSummary, type KickoffView } from "../../lib/kickoff";
import { KICKOFF_BUILD_RELATED_INCLUDE, shouldShowKickoffSummaryTiles } from "../../lib/kickoff-related";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { NextActionsPanel, useHubEmbed } from "./kickoff-chrome";
import { IntelligenceSection } from "./kickoff-intelligence";
import type { ActionBody } from "./kickoff-model";
import { PrioritySection } from "./kickoff-priority";
import { RulesSection } from "./kickoff-rules";
import { ScoringSection } from "./kickoff-scoring";

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

  const crumbs = embed === "build" ? "Build / Kickoff" : "Season / Kickoff";

  const load = useCallback(async () => {
    setFetchFailed(false);
    setErrorStatus(null);
    const params = new URLSearchParams(window.location.search);
    const orgId = params.get("orgId");
    try {
      const response = await fetch(`/api/kickoff${orgId ? `?orgId=${encodeURIComponent(orgId)}` : ""}`);
      const data = (await response.json()) as KickoffView | { error?: string };
      if (!response.ok || !("status" in data)) {
        setError("error" in data && data.error ? data.error : "Could not load kickoff analysis.");
        setErrorStatus(response.status);
        setFetchFailed(true);
        return;
      }
      setError("");
      setView(data);
    } catch {
      setFetchFailed(true);
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

  if (fetchFailed || !view) {
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
        <PageHeader breadcrumbs={crumbs} title="Kickoff & Game Analysis" />
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
      </main>
    );
  }

  if (view.status === "setup_required") {
    return (
      <main className="module-page kick-page">
        <PageHeader
          breadcrumbs={crumbs}
          title="Kickoff & Game Analysis"
          description="Break the new game into scoring actions, rank them by value, and lock the design priorities."
        />
        <BuildHubRelated active="kickoff" include={[...KICKOFF_BUILD_RELATED_INCLUDE]} />
        <EmptyState badge="Setup required" badgeTone="setup" soft title="Choose your team" description={view.message}>
          <Button as="a" variant="primary" href="/workspace">
            Choose your team
          </Button>
        </EmptyState>
        <NextActionsPanel
          seasonYear={new Date().getUTCFullYear()}
          hasIntelligence={false}
          actionCount={0}
          priorityCount={0}
          openRuleCount={0}
        />
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
        title="Kickoff & Game Analysis"
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
