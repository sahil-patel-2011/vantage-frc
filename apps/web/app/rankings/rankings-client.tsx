"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { Button } from "../../components/ui";
import { ExportButton, type CsvColumn } from "../../components/ui/export-button";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import {
  epaBarWidth,
  fmtRankTime,
  groupPlayoffs,
  ourStanding,
  stripFrc,
  type PlayoffMatch,
  type RankedTeam,
  type RankingsView,
} from "../../lib/rankings";
import { useCockpitPrefs } from "../../lib/cockpit/use-cockpit-prefs";
import {
  RANKINGS_POLL_MS,
  rankingsCacheRequiredCopy,
  shouldRefreshRankings,
} from "../../lib/rankings/tba-cache";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";

function isRankingsView(value: unknown): value is RankingsView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "ready";
}

async function persistRankingsSnapshot(orgHint: string, data: RankingsView): Promise<void> {
  const cacheOrg = data.context.orgId?.trim() || orgHint;
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("rankings", cacheOrg, data);
    if (!orgHint) await putFeatureSnapshot("rankings", "_", data);
  } catch {
    // Live rankings already painted; IndexedDB is best-effort.
  }
}

function fmtEpa(value: number | null): string {
  return value == null ? "—" : value.toFixed(1);
}

/**
 * CSV shape of the rankings board. Raw numbers only — the on-screen "—" and the
 * one-decimal EPA rounding are display choices, and a spreadsheet wants the value.
 */
const RANKINGS_CSV_COLUMNS: CsvColumn<RankedTeam>[] = [
  { key: "rank", header: "Rank", hint: "Official event rank", value: (team) => team.rank },
  { key: "team", header: "Team", hint: "Team number", value: (team) => team.teamNumber || null },
  { key: "nickname", header: "Nickname", value: (team) => team.nickname },
  { key: "record", header: "Record", hint: "Wins-losses-ties", value: (team) => team.record },
  { key: "epaTotal", header: "Rating total", hint: "Unrounded — screen shows 1 decimal", value: (team) => team.epaTotal },
  { key: "epaAuto", header: "Rating auto", value: (team) => team.epaAuto },
  { key: "epaTeleop", header: "Rating teleop", value: (team) => team.epaTeleop },
  { key: "epaEndgame", header: "Rating endgame", value: (team) => team.epaEndgame },
  { key: "source", header: "Source", hint: "Where the metric came from", value: (team) => team.source },
];

function TeamRow({ team, maxEpa, isUs }: { team: RankedTeam; maxEpa: number; isUs: boolean }) {
  return (
    <li className={isUs ? "rank-row us" : "rank-row"}>
      <span className="rank-pos">{team.rank ?? "—"}</span>
      <span className="rank-team">
        <b>{team.teamNumber}</b>
        <span className="rank-nick">{team.nickname ?? "—"}</span>
        {isUs ? <i className="rank-us">US</i> : null}
      </span>
      <span className="rank-record">{team.record ?? "—"}</span>
      <span className="rank-epa">
        <span className="rank-epa-top">
          <b>{fmtEpa(team.epaTotal)}</b>
          <span className="rank-epa-bar" aria-hidden="true">
            <i style={{ width: `${epaBarWidth(team.epaTotal, maxEpa)}%` }} />
          </span>
        </span>
        <span className="rank-epa-split">
          A {fmtEpa(team.epaAuto)} · T {fmtEpa(team.epaTeleop)} · E {fmtEpa(team.epaEndgame)}
        </span>
      </span>
      <span className="rank-source-chip">{team.source ?? "—"}</span>
    </li>
  );
}

function AllianceLine({
  color,
  keys,
  score,
  won,
  teamKey,
}: {
  color: "red" | "blue";
  keys: string[];
  score: number | null;
  won: boolean;
  teamKey: string | null;
}) {
  return (
    <div className={won ? `rank-alliance ${color} win` : `rank-alliance ${color}`}>
      <i className={`rank-dot ${color}`} aria-hidden="true" />
      <span className="rank-alliance-teams">
        {keys.length === 0 ? <span className="rank-tbd">TBD</span> : null}
        {keys.map((key) => (
          <b key={key} className={teamKey != null && key === teamKey ? "us" : undefined}>
            {stripFrc(key)}
          </b>
        ))}
      </span>
      {score != null ? <span className="rank-score">{score}</span> : null}
    </div>
  );
}

function PlayoffCard({ match, teamKey }: { match: PlayoffMatch; teamKey: string | null }) {
  const scored = match.redScore != null && match.blueScore != null;
  const ourSide =
    teamKey == null ? null : match.red.includes(teamKey) ? "red" : match.blue.includes(teamKey) ? "blue" : null;
  return (
    <li className={ourSide ? "rank-match ours" : "rank-match"}>
      <div className="rank-match-top">
        <strong>{match.label}</strong>
        {ourSide ? <i className="rank-us">US</i> : null}
        {scored && match.winner ? (
          <span className={`rank-winner ${match.winner}`}>{match.winner === "red" ? "Red wins" : "Blue wins"}</span>
        ) : (
          <span className="rank-match-time">{fmtRankTime(match.scheduledTime) || "Time TBD"}</span>
        )}
      </div>
      <AllianceLine color="red" keys={match.red} score={match.redScore} won={match.winner === "red"} teamKey={teamKey} />
      <AllianceLine color="blue" keys={match.blue} score={match.blueScore} won={match.winner === "blue"} teamKey={teamKey} />
    </li>
  );
}

export default function RankingsClient() {
  const cockpit = useCockpitPrefs();
  const [view, setView] = useState<RankingsView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [tab, setTab] = useState<"rankings" | "playoffs">("rankings");
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const inFlightRef = useRef(false);
  const viewRef = useRef<RankingsView | null>(null);
  viewRef.current = view;

  const load = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId")?.trim() ?? "";
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<RankingsView>("rankings", urlOrg || "_");
      if (!viewRef.current && cached?.data && isRankingsView(cached.data)) {
        setView(cached.data);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        hadCache = true;
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    try {
      const response = await fetch(`/api/rankings${urlOrg ? `?orgId=${encodeURIComponent(urlOrg)}` : ""}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data = (await response.json()) as RankingsView | { error?: string };
      if (!response.ok || !isRankingsView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Rankings. Showing the last copy on this device.");
          setFetchFailed(false);
        } else {
          setError("error" in data && data.error ? data.error : "Could not load event rankings.");
          setErrorStatus(response.status);
          setFetchFailed(true);
        }
        return;
      }
      setError("");
      setErrorStatus(null);
      setFetchFailed(false);
      setView(data);
      setFromCache(false);
      setCachedAt(null);
      await persistRankingsSnapshot(urlOrg, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setError("Could not refresh Rankings. Showing the last copy on this device.");
        setFetchFailed(false);
      } else {
        setFetchFailed(true);
      }
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    const poll = async () => {
      if (cancelled) return;
      if (
        !shouldRefreshRankings({
          visibilityState: document.visibilityState,
          inFlight: inFlightRef.current,
          pauseWhenHidden: cockpit.pauseLiveWhenHidden,
        })
      ) {
        return;
      }
      await load();
    };

    void poll();

    const arm = () => {
      timer = window.setTimeout(() => {
        void poll().finally(() => {
          if (!cancelled) arm();
        });
      }, RANKINGS_POLL_MS);
    };
    arm();

    const onVisibility = () => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load, cockpit.pauseLiveWhenHidden]);

  if (!view) {
    return (
      <main className="module-page rank-page">
        <header className="app-page-header">
          <div>
            <span className="breadcrumbs">Competition / Rankings</span>
            <h1>Rankings & playoffs</h1>
          </div>
        </header>
        <OfflineBanner feature="Rankings" fromCache={fromCache} cachedAt={cachedAt} />
        <div className="app-card rank-empty">
          {fetchFailed ? (
            (() => {
              const copy = loadFailureCopy(
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
              );
              return (
                <>
                  <strong>{copy.title}</strong>
                  <p className="app-muted">{copy.description}</p>
                  {copy.primary ? (
                    <Button as="a" variant="primary" href={copy.primary.href}>
                      {copy.primary.label}
                    </Button>
                  ) : null}
                  {copy.showRetry ? (
                    <Button variant="secondary" type="button" onClick={() => void load()}>
                      Retry
                    </Button>
                  ) : null}
                </>
              );
            })()
          ) : (
            <p className="app-muted">Loading event rankings…</p>
          )}
        </div>
      </main>
    );
  }

  if (view.status === "setup_required") {
    return (
      <main className="module-page rank-page">
        <header className="app-page-header">
          <div>
            <span className="breadcrumbs">Competition / Rankings</span>
            <h1>Rankings & playoffs</h1>
            <p>Every team at your active event ranked, plus the elimination bracket as it unfolds.</p>
          </div>
        </header>
        <OfflineBanner feature="Rankings" fromCache={fromCache} cachedAt={cachedAt} />
        <div className="app-card rank-empty">
          <strong>Almost there</strong>
          <p className="app-muted">{view.message}</p>
          <Button as="a" variant="primary" href="/workspace">
            Choose your team
          </Button>
        </div>
      </main>
    );
  }

  const teamKey = view.context.teamNumber != null ? `frc${view.context.teamNumber}` : null;
  const standing = teamKey ? ourStanding(view.teams, teamKey) : null;
  const maxEpa = view.teams.reduce(
    (acc, entry) => (entry.epaTotal != null && entry.epaTotal > acc ? entry.epaTotal : acc),
    0,
  );
  const syncedLabel = view.syncedAt ? fmtRankTime(view.syncedAt) : "";
  const groups = groupPlayoffs(view.playoffs);

  return (
    <main className="module-page rank-page">
      <header className="app-page-header">
        <div>
          <span className="breadcrumbs">Competition / Rankings</span>
          <h1>Rankings & playoffs</h1>
          <p>
            {view.context.eventName ?? view.context.eventKey}
            {view.context.teamNumber != null ? ` — Team ${view.context.teamNumber}` : ""}
            {syncedLabel ? ` · Data synced ${syncedLabel}` : ""}
          </p>
        </div>
        <div className="rank-header-actions">
          {standing ? (
            <span className="rank-standing">
              #{standing.rank} of {standing.of} · top {standing.percentile}%
            </span>
          ) : null}
          <Button variant="secondary" type="button" onClick={() => void load()}>
            Refresh
          </Button>
        </div>
      </header>
      <OfflineBanner feature="Rankings" fromCache={fromCache} cachedAt={cachedAt} />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      <div className="rank-tabs" role="group" aria-label="Rankings view">
        <button type="button" className={tab === "rankings" ? "active" : undefined} onClick={() => setTab("rankings")}>
          Rankings
        </button>
        <button type="button" className={tab === "playoffs" ? "active" : undefined} onClick={() => setTab("playoffs")}>
          Playoffs
        </button>
      </div>

      {tab === "rankings" ? (
        view.teams.length === 0 ? (
          <div className="app-card rank-empty">
            <strong>{rankingsCacheRequiredCopy().title}</strong>
            <p className="app-muted">{rankingsCacheRequiredCopy().description}</p>
            <Button as="a" variant="primary" href="/team/data">
              Open Team → Data
            </Button>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
              <ExportButton
                rows={view.teams}
                columns={RANKINGS_CSV_COLUMNS}
                feature="Rankings"
                orgLabel={view.context.orgName}
                orgId={view.context.orgId}
                size="sm"
                provenance={`${view.context.eventName ?? view.context.eventKey ?? "Active event"} — cached event numbers${
                  syncedLabel ? `, synced ${syncedLabel}` : ""
                }.`}
              />
            </div>
            <ul className="rank-list">
              <li className="rank-row rank-head" aria-hidden="true">
                <span className="rank-pos">#</span>
                <span className="rank-team">Team</span>
                <span className="rank-record">Record</span>
                <span className="rank-epa">Rating · auto / teleop / endgame</span>
                <span className="rank-source-label">Source</span>
              </li>
              {view.teams.map((entry) => (
                <TeamRow key={entry.teamKey} team={entry} maxEpa={maxEpa} isUs={teamKey === entry.teamKey} />
              ))}
            </ul>
          </>
        )
      ) : groups.length === 0 ? (
        <div className="app-card rank-empty">
          <strong>No elimination matches synced yet</strong>
          <p className="app-muted">The bracket fills in once playoff results are posted for this event.</p>
        </div>
      ) : (
        <div className="rank-bracket">
          {groups.map((group) => (
            <section key={group.level} className="rank-round">
              <h2>
                {group.label}
                <span>{group.matches.length}</span>
              </h2>
              <ul>
                {group.matches.map((entry) => (
                  <PlayoffCard key={entry.matchKey} match={entry} teamKey={teamKey} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
