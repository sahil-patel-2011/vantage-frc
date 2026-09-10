"use client";

// PIT DISPLAY V2 — the phase-aware board for the competition weekend.
//
// The board reads where the event actually is from SYNCED rows (pre-event ->
// quals -> alliance selection -> playoffs -> post-event) and rotates only
// through the screens that have real rows behind them. A team with no sponsors
// gets no sponsor scroll; an event with no ranking rows gets no ranking screen;
// a venue Nexus never mapped gets no map. Nothing here is ever filled in.
//
// The original kiosk (/display/kiosk, /display/pit) is untouched — this is a
// second board in the same route family, on the same read-only display token.

import { useCallback, useEffect, useMemo, useState } from "react";
import { NEXUS_QUEUE_STAGES } from "@vantage/reference";
import { hasNexusQueueSignal, nexusQueueCountdown } from "../../../lib/command/nexus-queue";
import {
  DISPLAY_FONT_SCALES,
  DISPLAY_PHASE_LABELS,
  DISPLAY_SCREEN_HOLD_MS,
  bracketRounds,
  displayPhase,
  fontScaleLabel,
  formatAlliance,
  matchLabel,
  nextFontScale,
  sponsorScrollText,
  stageRotation,
  venueShapeLabel,
  type DisplayStagePayload,
  type DisplayStageScreen,
} from "../../../lib/display";

const SCALE_STORAGE_KEY = "vantage.display.stage.scale";

const SCREEN_TITLES: Record<DisplayStageScreen, string> = {
  schedule: "OUR SCHEDULE",
  pit_map: "PIT MAP",
  queue: "QUEUE",
  next_match: "NEXT MATCH",
  rankings: "RANKINGS",
  alliance_selection: "ALLIANCE SELECTION",
  bracket: "PLAYOFF BRACKET",
  results: "RESULTS",
  thanks: "THANK YOU",
};

function clockLabel(value: string | number | null | undefined): string | null {
  if (value == null) return null;
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function readStoredScale(): number {
  if (typeof window === "undefined") return 1;
  const raw = Number(window.localStorage.getItem(SCALE_STORAGE_KEY));
  return (DISPLAY_FONT_SCALES as readonly number[]).includes(raw) ? raw : 1;
}

export default function StageClient({
  params,
}: {
  params: { orgId?: string; boardId?: string; token?: string };
}) {
  const [data, setData] = useState<DisplayStagePayload | null>(null);
  const [error, setError] = useState("");
  const [online, setOnline] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [tick, setTick] = useState(0);
  const [scale, setScale] = useState(1);
  const [chromeVisible, setChromeVisible] = useState(true);

  useEffect(() => setScale(readStoredScale()), []);

  const refresh = useCallback(async () => {
    if (!params.token && !(params.orgId && params.boardId)) {
      setError("Provide a TV token, or orgId and boardId while signed in.");
      return;
    }
    const query = params.token
      ? `token=${encodeURIComponent(params.token)}`
      : `orgId=${encodeURIComponent(params.orgId!)}&boardId=${encodeURIComponent(params.boardId!)}`;
    try {
      const response = await fetch(`/api/display/stage?${query}`, { cache: "no-store" });
      const payload = (await response.json()) as DisplayStagePayload & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Display unavailable");
      if (!payload.board) throw new Error("Display board not found");
      setData(payload);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Display offline");
    }
  }, [params]);

  useEffect(() => {
    void refresh();
    const clock = setInterval(() => setNow(Date.now()), 1_000);
    const live = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void refresh();
    }, 30_000);
    const advance = setInterval(() => setTick((value) => value + 1), DISPLAY_SCREEN_HOLD_MS);
    const status = () => setOnline(navigator.onLine);
    status();
    addEventListener("online", status);
    addEventListener("offline", status);
    return () => {
      clearInterval(clock);
      clearInterval(live);
      clearInterval(advance);
      removeEventListener("online", status);
      removeEventListener("offline", status);
    };
  }, [refresh]);

  // The board is a TV: controls fade out and come back on any touch.
  useEffect(() => {
    if (!chromeVisible) return;
    const hide = window.setTimeout(() => setChromeVisible(false), 8_000);
    return () => window.clearTimeout(hide);
  }, [chromeVisible, tick]);

  const phase = useMemo(() => displayPhase({ progress: data?.progress ?? null }), [data?.progress]);
  const rotation = useMemo(
    () =>
      data
        ? stageRotation(phase, {
            schedule: data.schedule ?? [],
            rankings: data.rankings ?? [],
            playoffMatches: data.playoffMatches ?? [],
            sponsors: data.sponsors ?? [],
            nexus: data.nexus ?? null,
            eventStatus: data.eventStatus ?? null,
          })
        : [],
    [data, phase],
  );
  const screen = rotation.length ? rotation[tick % rotation.length] : null;
  const sponsorText = sponsorScrollText(data?.sponsors ?? []);

  const cycleScale = () => {
    const next = nextFontScale(scale);
    setScale(next);
    try {
      window.localStorage.setItem(SCALE_STORAGE_KEY, String(next));
    } catch {
      // A kiosk in private mode simply does not remember the size.
    }
  };

  if (!data) {
    return (
      <main className={`display-stage ${error ? "error" : "loading"}`}>
        <h1>{error || "Loading display…"}</h1>
        <p>
          {params.token
            ? "Read-only TV token. If this fails, the token may be revoked or expired."
            : "Signed-in preview needs a saved board id for this workspace."}
        </p>
        <button type="button" className="stage-btn" onClick={() => void refresh()}>
          Retry
        </button>
      </main>
    );
  }

  const eventName = data.activeEvent?.name ?? data.activeEvent?.eventKey ?? "NO ACTIVE EVENT";

  return (
    <main
      className={`display-stage${chromeVisible ? " is-chrome" : ""}`}
      style={{ ["--stage-scale" as string]: String(scale) }}
      onPointerDown={() => setChromeVisible(true)}
    >
      <header className="stage-head">
        <div className="stage-brand">
          <span>{eventName}</span>
          <strong>
            {data.organization.name} · #{data.organization.teamNumber}
          </strong>
        </div>
        <div className="stage-phase">
          <span className={online ? "is-online" : "is-offline"}>
            {online ? DISPLAY_PHASE_LABELS[phase] : "OFFLINE · LAST DATA"}
          </span>
          <time dateTime={data.updatedAt}>{clockLabel(data.updatedAt) ?? ""}</time>
        </div>
        <div className="stage-controls">
          <button type="button" className="stage-btn" onClick={cycleScale} aria-label="Change text size">
            Text {fontScaleLabel(scale)}
          </button>
          <button type="button" className="stage-btn" onClick={() => setTick((value) => value + 1)}>
            Next screen
          </button>
          <button
            type="button"
            className="stage-btn"
            onClick={() => void document.documentElement.requestFullscreen?.()}
          >
            Fullscreen
          </button>
          <button type="button" className="stage-btn" onClick={() => void refresh()}>
            Refresh
          </button>
        </div>
      </header>

      {screen ? (
        <section className="stage-screen" aria-live="polite">
          <h1 className="stage-screen-title">{SCREEN_TITLES[screen]}</h1>
          {renderScreen(screen, data, now)}
        </section>
      ) : (
        <section className="stage-screen stage-empty">
          <h1>Nothing synced for this event yet</h1>
          <p>
            The board shows a screen only when there are real rows behind it — schedule, rankings,
            bracket, Nexus queue, or your own sponsors. Sync the event and it fills in on its own.
          </p>
        </section>
      )}

      {rotation.length > 1 ? (
        <ol className="stage-dots" aria-hidden="true">
          {rotation.map((entry, index) => (
            <li key={entry} className={index === tick % rotation.length ? "is-current" : undefined} />
          ))}
        </ol>
      ) : null}

      {sponsorText ? (
        <footer className="stage-sponsors" aria-label="Sponsor thanks">
          <div className="stage-sponsor-track">
            <span>{sponsorText}</span>
            <span aria-hidden="true">{sponsorText}</span>
          </div>
        </footer>
      ) : null}

      {error ? <p className="stage-error">{error}</p> : null}
    </main>
  );
}

function renderScreen(screen: DisplayStageScreen, data: DisplayStagePayload, now: number) {
  switch (screen) {
    case "queue":
      return <QueueScreen data={data} now={now} />;
    case "next_match":
      return <NextMatchScreen data={data} />;
    case "schedule":
      return <ScheduleScreen data={data} />;
    case "rankings":
    case "alliance_selection":
      return <RankingsScreen data={data} selection={screen === "alliance_selection"} />;
    case "bracket":
    case "results":
      return <BracketScreen data={data} results={screen === "results"} />;
    case "pit_map":
      return <PitMapScreen data={data} />;
    case "thanks":
      return <ThanksScreen data={data} />;
    default:
      return null;
  }
}

function QueueScreen({ data, now }: { data: DisplayStagePayload; now: number }) {
  const queue = data.queue;
  if (!queue || !hasNexusQueueSignal(queue)) {
    return (
      <p className="stage-note">
        Nexus has not posted a queue, announcement, or parts request for this event yet.
      </p>
    );
  }
  const countdown = nexusQueueCountdown(queue, now);
  return (
    <div className="stage-queue">
      {countdown.match ? (
        <div className={`stage-countdown${countdown.urgent ? " is-urgent" : ""}`}>
          <span className="stage-kicker">{countdown.match.label ?? "Our next match"}</span>
          <strong className="stage-clock">{countdown.label}</strong>
          {countdown.cue ? <em className="stage-cue">{countdown.cue}</em> : null}
          <ol className="stage-stages">
            {NEXUS_QUEUE_STAGES.map((entry) => (
              <li key={entry.stage} className={entry.stage === countdown.stage ? "is-current" : undefined}>
                {entry.label}
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <p className="stage-note">Nexus has not posted a match with your team in the queue.</p>
      )}

      {queue.announcements.length ? (
        <div className="stage-block">
          <h2>Announcements</h2>
          <ul>
            {queue.announcements.map((entry, index) => (
              <li key={entry.id ?? `${index}-${entry.message}`}>{entry.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {queue.partsRequests.length ? (
        <div className="stage-block">
          <h2>Parts requests</h2>
          <ul>
            {queue.partsRequests.map((request, index) => (
              <li key={request.id ?? `${index}-${request.parts}`} className={request.nearby ? "is-near" : undefined}>
                {request.requestedByTeam ? `Team ${request.requestedByTeam}` : "A team"} needs {request.parts}
                {request.pitAddress ? ` · Pit ${request.pitAddress}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function NextMatchScreen({ data }: { data: DisplayStagePayload }) {
  const match = data.schedule?.[0];
  if (!match) return <p className="stage-note">No upcoming match for your team on the synced schedule.</p>;
  return (
    <div className="stage-next">
      <strong className="stage-clock">{matchLabel(match.compLevel, match.matchNumber)}</strong>
      <span className="stage-kicker">{clockLabel(match.scheduledTime) ?? "No scheduled time posted"}</span>
      <p className="stage-alliance is-red">RED {formatAlliance(match.redAlliance?.teamKeys)}</p>
      <p className="stage-alliance is-blue">BLUE {formatAlliance(match.blueAlliance?.teamKeys)}</p>
    </div>
  );
}

function ScheduleScreen({ data }: { data: DisplayStagePayload }) {
  const rows = data.schedule ?? [];
  if (!rows.length) return <p className="stage-note">No upcoming matches for your team yet.</p>;
  return (
    <div className="stage-table-wrap">
      <table className="stage-table">
        <thead>
          <tr>
            <th scope="col">Match</th>
            <th scope="col">Time</th>
            <th scope="col">Red</th>
            <th scope="col">Blue</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.matchKey}>
              <th scope="row">{matchLabel(row.compLevel, row.matchNumber)}</th>
              <td>{clockLabel(row.scheduledTime) ?? "—"}</td>
              <td className="is-red">{formatAlliance(row.redAlliance?.teamKeys)}</td>
              <td className="is-blue">{formatAlliance(row.blueAlliance?.teamKeys)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RankingsScreen({ data, selection }: { data: DisplayStagePayload; selection: boolean }) {
  const rows = data.rankings ?? [];
  if (!rows.length) return <p className="stage-note">No ranking rows synced for this event yet.</p>;
  const ourKey = `frc${data.organization.teamNumber}`;
  return (
    <div className="stage-table-wrap">
      {selection ? (
        <p className="stage-note stage-note-inline">
          Quals are complete. Rank order below is the synced standing — Vantage does not predict picks.
        </p>
      ) : null}
      <table className="stage-table">
        <thead>
          <tr>
            <th scope="col">Rank</th>
            <th scope="col">Team</th>
            <th scope="col">W-L-T</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.teamKey} className={row.teamKey === ourKey ? "is-ours" : undefined}>
              <th scope="row">{row.rank ?? "—"}</th>
              <td>{row.teamKey.replace(/^frc/i, "")}</td>
              <td>
                {row.wins == null && row.losses == null
                  ? "—"
                  : `${row.wins ?? 0}-${row.losses ?? 0}${row.ties ? `-${row.ties}` : ""}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BracketScreen({ data, results }: { data: DisplayStagePayload; results: boolean }) {
  const rounds = bracketRounds(data.playoffMatches ?? []);
  if (!rounds.length) return <p className="stage-note">No playoff matches posted yet.</p>;
  return (
    <div className="stage-bracket">
      {rounds.map((round) => (
        <section key={round.compLevel}>
          <h2>{round.compLevel.toUpperCase()}</h2>
          <ul>
            {round.matches.map((match) => (
              <li key={match.matchKey}>
                <span className={`stage-alliance is-red${match.winningAlliance === "red" ? " is-winner" : ""}`}>
                  {formatAlliance(match.redAlliance?.teamKeys)}
                </span>
                <span className={`stage-alliance is-blue${match.winningAlliance === "blue" ? " is-winner" : ""}`}>
                  {formatAlliance(match.blueAlliance?.teamKeys)}
                </span>
                {results && !match.winningAlliance ? <small>Not played</small> : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function PitMapScreen({ data }: { data: DisplayStagePayload }) {
  const map = data.venueMap;
  if (!map) {
    const pits = data.nexus?.pits ?? null;
    const ours = pits && data.organization.teamNumber ? pits[String(data.organization.teamNumber)] : null;
    if (ours) {
      return (
        <div className="stage-next">
          <span className="stage-kicker">OUR PIT</span>
          <strong className="stage-clock">{ours}</strong>
          <p className="stage-note">Nexus posted pit addresses for this event but no venue geometry.</p>
        </div>
      );
    }
    return <p className="stage-note">Nexus has not posted a venue map for this event.</p>;
  }
  return (
    <div className="stage-map">
      <svg viewBox={map.viewBox} role="img" aria-label="Venue pit map from Nexus">
        {map.shapes.map((shape, index) => (
          <g
            key={shape.id ?? `${shape.kind}-${index}`}
            transform={
              shape.rotation
                ? `rotate(${shape.rotation} ${shape.x + shape.width / 2} ${shape.y + shape.height / 2})`
                : undefined
            }
          >
            <rect
              x={shape.x}
              y={shape.y}
              width={shape.width}
              height={shape.height}
              className={`stage-shape kind-${shape.kind}${shape.ours ? " is-ours" : ""}${shape.requester ? " is-requester" : ""}`}
            />
            {venueShapeLabel(shape) ? (
              <text
                x={shape.x + shape.width / 2}
                y={shape.y + shape.height / 2}
                dominantBaseline="middle"
                textAnchor="middle"
                className="stage-shape-label"
              >
                {venueShapeLabel(shape)}
              </text>
            ) : null}
          </g>
        ))}
      </svg>
      <p className="stage-note stage-note-inline">
        Venue map from frc.nexus.
        {map.ourShape ? " Your pit is outlined." : " Nexus did not place your team on this map."}
        {map.requesterCount ? ` ${map.requesterCount} pit(s) have an open parts request.` : ""}
      </p>
    </div>
  );
}

function ThanksScreen({ data }: { data: DisplayStagePayload }) {
  const status = data.eventStatus;
  return (
    <div className="stage-thanks">
      <strong className="stage-clock">Thank you</strong>
      {status ? (
        <p className="stage-kicker">
          Finished {status.rank != null ? `rank ${status.rank}` : "the event"}
          {status.wins != null || status.losses != null
            ? ` · ${status.wins ?? 0}-${status.losses ?? 0}${status.ties ? `-${status.ties}` : ""}`
            : ""}
        </p>
      ) : null}
      {data.sponsors?.length ? (
        <ul className="stage-sponsor-list">
          {data.sponsors.map((sponsor) => (
            <li key={sponsor.name}>{sponsor.name}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
