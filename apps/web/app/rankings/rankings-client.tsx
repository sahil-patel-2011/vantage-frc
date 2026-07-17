"use client";

import { useCallback, useEffect, useState } from "react";
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

function fmtEpa(value: number | null): string {
  return value == null ? "—" : value.toFixed(1);
}

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
  const [view, setView] = useState<RankingsView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [tab, setTab] = useState<"rankings" | "playoffs">("rankings");

  const load = useCallback(async () => {
    const params = new URLSearchParams(window.location.search);
    const orgId = params.get("orgId");
    try {
      const response = await fetch(`/api/rankings${orgId ? `?orgId=${encodeURIComponent(orgId)}` : ""}`);
      const data = (await response.json()) as RankingsView | { error?: string };
      if (!response.ok || !("status" in data)) {
        setError("error" in data && data.error ? data.error : "Could not load event rankings.");
        setFetchFailed(true);
        return;
      }
      setError("");
      setFetchFailed(false);
      setView(data);
    } catch {
      setFetchFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      void load();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  if (!view) {
    return (
      <main className="module-page rank-page">
        <header className="app-page-header">
          <div>
            <span className="breadcrumbs">Competition / Rankings</span>
            <h1>Rankings & Playoffs</h1>
          </div>
        </header>
        <div className="app-card rank-empty">
          {fetchFailed ? (
            <>
              <strong>Could not load event rankings</strong>
              <p className="app-muted">{error || "Check your connection and try again."}</p>
              <button type="button" className="app-button secondary" onClick={() => void load()}>
                Retry
              </button>
            </>
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
            <h1>Rankings & Playoffs</h1>
            <p>Every team at your active event ranked, plus the elimination bracket as it unfolds.</p>
          </div>
        </header>
        <div className="app-card rank-empty">
          <strong>Almost there</strong>
          <p className="app-muted">{view.message}</p>
          <a className="app-button" href="/workspace">
            Open Workspace
          </a>
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
          <h1>Rankings & Playoffs</h1>
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
          <button type="button" className="app-button secondary" onClick={() => void load()}>
            Refresh
          </button>
        </div>
      </header>

      {fetchFailed ? (
        <p className="telemetry-status" role="alert">
          {error || "Auto-refresh failed — showing the last loaded rankings."}
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
            <strong>Reference metrics not synced yet</strong>
            <p className="app-muted">Sync TBA/Statbotics under Team → Data to populate event rankings.</p>
            <a className="app-button" href="/team/data">
              Open Team → Data
            </a>
          </div>
        ) : (
          <ul className="rank-list">
            <li className="rank-row rank-head" aria-hidden="true">
              <span className="rank-pos">#</span>
              <span className="rank-team">Team</span>
              <span className="rank-record">Record</span>
              <span className="rank-epa">EPA total · auto / teleop / endgame</span>
              <span className="rank-source-label">Source</span>
            </li>
            {view.teams.map((entry) => (
              <TeamRow key={entry.teamKey} team={entry} maxEpa={maxEpa} isUs={teamKey === entry.teamKey} />
            ))}
          </ul>
        )
      ) : groups.length === 0 ? (
        <div className="app-card rank-empty">
          <strong>No elimination matches synced yet</strong>
          <p className="app-muted">Brackets appear once playoffs begin.</p>
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
