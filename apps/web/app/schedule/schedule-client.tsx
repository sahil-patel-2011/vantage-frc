"use client";

import { useCallback, useEffect, useState } from "react";
import { AiInsightPanel } from "../../components/ai-insight-panel";
import {
  allianceOf,
  compLevelLabel,
  fmtMatchTime,
  isScored,
  matchesUntil,
  matchResult,
  nextOurMatch,
  ourMatches,
  splitByLevel,
  stripFrc,
  type ScheduleMatch,
  type ScheduleView,
} from "../../lib/schedule-board";

function AllianceTeams({ keys, color, teamKey, ours }: { keys: string[]; color: "red" | "blue"; teamKey: string | null; ours: boolean }) {
  return (
    <span className="sched-alliance">
      <i className={`sched-dot ${color}`} aria-hidden="true" />
      {keys.map((key) => (
        <b key={key} className={teamKey != null && key === teamKey ? "sched-team us" : "sched-team"}>
          {stripFrc(key)}
        </b>
      ))}
      {ours ? <i className={`sched-us ${color}`}>US</i> : null}
    </span>
  );
}

function MatchRow({ match, teamKey, isNext }: { match: ScheduleMatch; teamKey: string | null; isNext: boolean }) {
  const side = teamKey ? allianceOf(match, teamKey) : null;
  const outcome = teamKey ? matchResult(match, teamKey) : null;
  const scored = isScored(match);
  const rowClass = ["sched-row", side ? "ours" : "", isNext ? "next" : ""].filter(Boolean).join(" ");

  return (
    <li className={rowClass}>
      <div className="sched-id">
        <strong>
          {compLevelLabel(match.compLevel)} {match.matchNumber}
        </strong>
        <span className="sched-time">{fmtMatchTime(match.scheduledTime)}</span>
      </div>
      <div className="sched-alliances">
        <AllianceTeams keys={match.red} color="red" teamKey={teamKey} ours={side === "red"} />
        <span className="sched-vs">vs</span>
        <AllianceTeams keys={match.blue} color="blue" teamKey={teamKey} ours={side === "blue"} />
      </div>
      <div className="sched-right">
        {scored ? (
          <span className="sched-score">
            <b className={match.winningAlliance === "red" ? "win" : undefined}>{match.redScore}</b>
            <span className="sched-score-sep">–</span>
            <b className={match.winningAlliance === "blue" ? "win" : undefined}>{match.blueScore}</b>
          </span>
        ) : null}
        {outcome ? <span className={`sched-wlt ${outcome.result.toLowerCase()}`}>{outcome.result}</span> : null}
        {isNext ? <span className="sched-chip ondeck">On deck</span> : null}
        {match.scoutCount > 0 ? (
          <span className="sched-chip">
            {match.scoutCount} {match.scoutCount === 1 ? "scout" : "scouts"}
          </span>
        ) : null}
      </div>
    </li>
  );
}

export default function ScheduleClient() {
  const [view, setView] = useState<ScheduleView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [scope, setScope] = useState<"all" | "ours">("all");
  const [hidePlayed, setHidePlayed] = useState(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams(window.location.search);
    const orgId = params.get("orgId");
    try {
      const response = await fetch(`/api/schedule${orgId ? `?orgId=${encodeURIComponent(orgId)}` : ""}`);
      const data = (await response.json()) as ScheduleView | { error?: string };
      if (!response.ok || !("status" in data)) {
        setError("error" in data && data.error ? data.error : "Could not load the match schedule.");
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
      <main className="module-page sched-page">
        <header className="app-page-header">
          <div>
            <span className="breadcrumbs">Competition / Schedule</span>
            <h1>Match Schedule</h1>
          </div>
        </header>
        <div className="app-card sched-empty">
          {fetchFailed ? (
            <>
              <strong>Could not load the match schedule</strong>
              <p className="app-muted">{error || "Check your connection and try again."}</p>
              <button type="button" className="app-button secondary" onClick={() => void load()}>
                Retry
              </button>
            </>
          ) : (
            <p className="app-muted">Loading match schedule…</p>
          )}
        </div>
      </main>
    );
  }

  if (view.status === "setup_required") {
    return (
      <main className="module-page sched-page">
        <header className="app-page-header">
          <div>
            <span className="breadcrumbs">Competition / Schedule</span>
            <h1>Match Schedule</h1>
            <p>Every match at your active event — your matches highlighted, with results and scout coverage.</p>
          </div>
        </header>
        <div className="app-card sched-empty">
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
  const next = teamKey ? nextOurMatch(view.matches, teamKey) : null;
  const nextSide = next && teamKey ? allianceOf(next, teamKey) : null;
  const until = next ? matchesUntil(view.matches, next) : 0;
  const partners =
    next && nextSide && teamKey
      ? (nextSide === "red" ? next.red : next.blue).filter((key) => key !== teamKey).map(stripFrc)
      : [];
  const opponents = next && nextSide ? (nextSide === "red" ? next.blue : next.red).map(stripFrc) : [];

  const base = scope === "ours" && teamKey ? ourMatches(view.matches, teamKey) : view.matches;
  const visible = hidePlayed ? base.filter((entry) => !isScored(entry)) : base;
  const groups = splitByLevel(visible);

  return (
    <main className="module-page sched-page">
      <header className="app-page-header">
        <div>
          <span className="breadcrumbs">Competition / Schedule</span>
          <h1>Match Schedule</h1>
          <p>
            {view.context.eventName ?? view.context.eventKey}
            {view.context.teamNumber ? ` — Team ${view.context.teamNumber}` : ""} · {view.matches.length}{" "}
            {view.matches.length === 1 ? "match" : "matches"}
          </p>
        </div>
        <button type="button" className="app-button secondary" onClick={() => void load()}>
          Refresh
        </button>
      </header>

      {fetchFailed ? (
        <p className="telemetry-status" role="alert">
          {error || "Auto-refresh failed — showing the last loaded schedule."}
        </p>
      ) : null}

      {next && nextSide ? (
        <section className="sched-hero">
          <div className="sched-hero-main">
            <span className="sched-hero-kicker">Your next match</span>
            <strong className="sched-hero-match">
              {compLevelLabel(next.compLevel)} {next.matchNumber}
            </strong>
            <span className="sched-hero-sub">
              {fmtMatchTime(next.scheduledTime) || "Time TBD"} ·{" "}
              {until === 0 ? "you're up next" : `${until} ${until === 1 ? "match" : "matches"} until you're up`}
            </span>
          </div>
          <div className="sched-hero-detail">
            <span className={`sched-alliance-chip ${nextSide}`}>
              {nextSide === "red" ? "Switch to RED bumpers" : "Switch to BLUE bumpers"}
            </span>
            <span className="sched-hero-teams">
              With {partners.length ? partners.join(" · ") : "—"}
              <em> vs {opponents.length ? opponents.join(" · ") : "—"}</em>
            </span>
          </div>
        </section>
      ) : null}

      <div className="sched-controls">
        <div className="sched-toggle" role="group" aria-label="Match filter">
          <button type="button" className={scope === "all" ? "active" : undefined} onClick={() => setScope("all")}>
            All matches
          </button>
          <button
            type="button"
            className={scope === "ours" ? "active" : undefined}
            disabled={!teamKey}
            title={teamKey ? undefined : "Set a team number in Workspace to filter"}
            onClick={() => setScope("ours")}
          >
            Our matches
          </button>
        </div>
        <label className="sched-check">
          <input type="checkbox" checked={hidePlayed} onChange={(event) => setHidePlayed(event.target.checked)} />
          Hide played
        </label>
      </div>

      {view.matches.length === 0 ? (
        <div className="app-card sched-empty">
          <strong>No matches synced for this event yet</strong>
          <p className="app-muted">Once the schedule is posted and reference sync runs, matches appear here automatically.</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="app-card sched-empty">
          <strong>Nothing matches your filters</strong>
          <p className="app-muted">Try showing played matches or switching back to all matches.</p>
        </div>
      ) : (
        groups.map((group) => (
          <section key={group.level} className="sched-group">
            <h2>
              {group.label}
              <span>{group.matches.length}</span>
            </h2>
            <ul>
              {group.matches.map((entry) => (
                <MatchRow key={entry.matchKey} match={entry} teamKey={teamKey} isNext={entry.matchKey === next?.matchKey} />
              ))}
            </ul>
          </section>
        ))
      )}

      <AiInsightPanel
        orgId={view.context.orgId ?? ""}
        kind="model_accuracy"
        title="Prediction accuracy"
        description="How well the strategy model has called played matches — accuracy, calibration, and the biggest miss."
      />
    </main>
  );
}
