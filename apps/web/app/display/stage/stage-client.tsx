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
import { kioskBrandLine } from "../../../lib/display/kiosk-view";
import { type DisplayMatchIntel, toDisplayMatchIntel } from "../../../lib/display/match-intel";

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
  const [intel, setIntel] = useState<DisplayMatchIntel | null>(null);

  useEffect(() => setScale(readStoredScale()), []);

  // What the team already knows about the next match: stored prediction and the opponent
  // tendencies saved with its plan. Fetched when the next match changes, not every refresh.
  const nextMatch = data?.schedule?.[0] ?? null;
  const nextMatchKey = nextMatch?.matchKey ?? null;
  const ownKey = data?.organization?.teamNumber ? `frc${data.organization.teamNumber}` : null;
  useEffect(() => {
    if (!nextMatchKey || !nextMatch) {
      setIntel(null);
      return;
    }
    let active = true;
    const access = params.token
      ? `token=${encodeURIComponent(params.token)}`
      : params.orgId
        ? `orgId=${encodeURIComponent(params.orgId)}`
        : "";
    if (!access) return;
    void fetch(`/api/display/intel?matchKey=${encodeURIComponent(nextMatchKey)}&${access}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { intel?: unknown } | null) => {
        if (!active) return;
        setIntel(
          toDisplayMatchIntel((body?.intel ?? null) as Parameters<typeof toDisplayMatchIntel>[0], ownKey, {
            red: nextMatch.redAlliance?.teamKeys ?? [],
            blue: nextMatch.blueAlliance?.teamKeys ?? [],
          }),
        );
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
    // nextMatch is read through nextMatchKey; refetching on every 30s snapshot would be noise.
  }, [nextMatchKey, ownKey, params.token, params.orgId]);

  const refresh = useCallback(async () => {
    if (!params.token && !(params.orgId && params.boardId)) {
      setError("This screen's link is incomplete. Open Pit TV on a signed-in computer and use the link it gives you for this board.");
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
  // From half an hour before our match until ten minutes after its time, the TV stops
  // rotating and holds the next-match screen: that is the only thing the pit needs then.
  const minutesToNext = nextMatch?.scheduledTime ? (new Date(nextMatch.scheduledTime).getTime() - now) / 60_000 : null;
  const pinNext =
    minutesToNext != null && Number.isFinite(minutesToNext) && minutesToNext <= 30 && minutesToNext >= -10 && rotation.includes("next_match");
  const screen = pinNext ? "next_match" : rotation.length ? rotation[tick % rotation.length] : null;
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
            ? "If this keeps failing, the TV link was turned off. Make a new one on the Pit TV page."
            : "Open the event board from the Pit TV page."}
        </p>
        <button type="button" className="stage-btn" onClick={() => void refresh()}>
          Retry
        </button>
      </main>
    );
  }

  const eventName = data.activeEvent?.name ?? data.activeEvent?.eventKey ?? null;

  return (
    <main
      className={`display-stage${chromeVisible ? " is-chrome" : ""}`}
      style={{ ["--stage-scale" as string]: String(scale) }}
      onPointerDown={() => setChromeVisible(true)}
    >
      <header className="stage-head">
        <div className="stage-brand">
          <span>Pit TV · Event board</span>
          <strong>{kioskBrandLine(data.organization, eventName)}</strong>
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
          {renderScreen(screen, data, now, intel)}
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

function renderScreen(screen: DisplayStageScreen, data: DisplayStagePayload, now: number, intel: DisplayMatchIntel | null) {
  switch (screen) {
    case "queue":
      return <QueueScreen data={data} now={now} />;
    case "next_match":
      return <NextMatchScreen data={data} now={now} intel={intel} />;
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

/** "in 14 min", "in 1 h 5 min", "now" — the pit's one question about the clock. */
function countdownLabel(scheduled: string | null, now: number): string | null {
  if (!scheduled) return null;
  const at = new Date(scheduled).getTime();
  if (!Number.isFinite(at)) return null;
  const minutes = Math.round((at - now) / 60_000);
  if (minutes <= 0) return "now";
  if (minutes < 60) return `in ${minutes} min`;
  return `in ${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function NextMatchScreen({ data, now, intel }: { data: DisplayStagePayload; now: number; intel: DisplayMatchIntel | null }) {
  const match = data.schedule?.[0];
  if (!match) return <p className="stage-note">No upcoming match for your team on the synced schedule.</p>;
  const ownKey = `frc${data.organization.teamNumber}`;
  const red = match.redAlliance?.teamKeys ?? [];
  const blue = match.blueAlliance?.teamKeys ?? [];
  const ourColor: "red" | "blue" | null = red.includes(ownKey) ? "red" : blue.includes(ownKey) ? "blue" : null;
  const partners = ourColor === "red" ? red : ourColor === "blue" ? blue : [];
  const opponents = ourColor === "red" ? blue : ourColor === "blue" ? red : [];
  const tagsFor = (teamKey: string) => intel?.teams.find((row) => row.teamKey === teamKey)?.tags ?? [];
  const countdown = countdownLabel(match.scheduledTime, now);

  const teamList = (keys: string[], color: "red" | "blue") => (
    <ul className={`stage-lineup is-${color}`}>
      {keys.map((key) => (
        <li key={key} className={key === ownKey ? "is-ours" : undefined}>
          <strong>{key.replace(/^frc/i, "")}</strong>
          {key === ownKey ? <span className="stage-us">Us</span> : null}
          {tagsFor(key).length ? <em>{tagsFor(key).join(" · ")}</em> : null}
        </li>
      ))}
    </ul>
  );

  return (
    <div className="stage-next">
      <div className="stage-next-head">
        <strong className="stage-clock">{matchLabel(match.compLevel, match.matchNumber)}</strong>
        <span className="stage-kicker">
          {countdown ? `${countdown} · ` : ""}
          {clockLabel(match.scheduledTime) ?? "No scheduled time posted"}
        </span>
      </div>

      {ourColor ? (
        <p className={`stage-bumpers is-${ourColor}`}>
          WE ARE {ourColor.toUpperCase()} <small>{ourColor === "red" ? "Red" : "Blue"} bumpers on</small>
        </p>
      ) : null}

      {ourColor ? (
        <div className="stage-sides">
          <section>
            <h2>With us</h2>
            {teamList(partners, ourColor)}
          </section>
          <section>
            <h2>Against us</h2>
            {teamList(opponents, ourColor === "red" ? "blue" : "red")}
          </section>
        </div>
      ) : (
        <>
          <p className="stage-alliance is-red">RED {formatAlliance(red)}</p>
          <p className="stage-alliance is-blue">BLUE {formatAlliance(blue)}</p>
        </>
      )}

      {intel?.ourWinPct != null ? (
        <p className="stage-win">
          {intel.ourWinPct}% chance to win <small>from the team&rsquo;s saved prediction</small>
        </p>
      ) : null}
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
  const all = data.rankings ?? [];
  if (!all.length) return <p className="stage-note">No ranking rows synced for this event yet.</p>;
  const ourKey = `frc${data.organization.teamNumber}`;
  // A TV cannot scroll: the top eight, plus our own row when we are further down.
  const top = all.slice(0, 8);
  const ours = all.find((row) => row.teamKey === ourKey);
  const rows = ours && !top.includes(ours) ? [...top, ours] : top;
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
