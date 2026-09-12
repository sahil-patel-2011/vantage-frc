"use client";

import "../../product-styles";
import { useCallback, useEffect, useState } from "react";
import {
  bumperBanner,
  countdownState,
  formatAlliance,
  hasEventCommandSignal,
  hasReadinessSignal,
  hasScoutingCoverageSignal,
  matchLabel,
  ourBumperColor,
  queueCue,
  rankLabel,
  recordLabel,
  formatDisplayPrediction,
  widgetValue,
  type DisplaySnapshot,
} from "../../../lib/display";
import { predictionWinDisplay } from "../../../lib/strategy/prediction-display";

export default function KioskClient({
  params,
  mode = "kiosk",
}: {
  params: { orgId?: string; boardId?: string; token?: string };
  mode?: "kiosk" | "pit";
}) {
  const [data, setData] = useState<DisplaySnapshot | null>(null);
  const [error, setError] = useState("");
  const [online, setOnline] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [chromeVisible, setChromeVisible] = useState(mode !== "pit");

  const refresh = useCallback(async () => {
    if (!params.token && !(params.orgId && params.boardId)) {
      setError("Provide a TV token, or orgId and boardId while signed in.");
      return;
    }
    const query = params.token
      ? `token=${encodeURIComponent(params.token)}`
      : `orgId=${encodeURIComponent(params.orgId!)}&boardId=${encodeURIComponent(params.boardId!)}`;
    try {
      const response = await fetch(`/api/display/snapshot?${query}`, { cache: "no-store" });
      const payload = (await response.json()) as DisplaySnapshot & { error?: string };
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
    const clock = setInterval(() => setNow(Date.now()), 1000);
    const live = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void refresh();
    }, 30_000);
    const status = () => setOnline(navigator.onLine);
    status();
    addEventListener("online", status);
    addEventListener("offline", status);
    return () => {
      clearInterval(clock);
      clearInterval(live);
      removeEventListener("online", status);
      removeEventListener("offline", status);
    };
  }, [refresh]);

  useEffect(() => {
    if (mode !== "pit" || !chromeVisible) return;
    const hide = window.setTimeout(() => setChromeVisible(false), 8_000);
    return () => window.clearTimeout(hide);
  }, [mode, chromeVisible]);

  if (!data) {
    return (
      <main className={`display-kiosk ${mode === "pit" ? "display-kiosk-pit " : ""}${error ? "error" : "loading"}`}>
        <h1>{error || "Loading display…"}</h1>
        <p>
          {params.token
            ? mode === "pit"
              ? "Pit display token. If this fails, the token may be revoked or expired."
              : "Using read-only TV token. If this fails, the token may be revoked or expired."
            : "Signed-in kiosk needs a saved board id for this team."}
        </p>
        <button type="button" onClick={() => void refresh()}>
          Retry
        </button>
      </main>
    );
  }

  const match = data.nextMatch;
  const prediction = data.prediction;
  const clock = countdownState(match?.scheduledTime, now);
  const bumper = ourBumperColor(match, data.organization.teamNumber);
  const eventName = data.activeEvent?.name ?? "NO ACTIVE EVENT";
  const readiness = data.readiness;

  return (
    <main
      className={`display-kiosk preset-${data.board.preset}${mode === "pit" ? " display-kiosk-pit" : ""}${mode === "pit" && chromeVisible ? " is-chrome" : ""}`}
      onPointerDown={() => {
        if (mode === "pit") setChromeVisible(true);
      }}
    >
      <header>
        <div className="kiosk-brand">
          <span>{mode === "pit" ? "PIT TV" : "EVENT DISPLAY"}</span>
          <strong>
            {data.organization.name} · #{data.organization.teamNumber}
          </strong>
        </div>
        <div className={`kiosk-status ${online ? "online" : "offline"}`}>
          {online ? "CONNECTED" : "OFFLINE · LAST DATA"}
        </div>
        <div className="kiosk-controls">
          <button type="button" onClick={() => void document.documentElement.requestFullscreen?.()}>
            Fullscreen
          </button>
          <button type="button" onClick={() => void refresh()}>
            Refresh
          </button>
        </div>
      </header>

      <section className="display-kiosk-title">
        <div>
          <span>{eventName}</span>
          <h1>{data.board.name}</h1>
        </div>
        <time dateTime={data.updatedAt}>Updated {new Date(data.updatedAt).toLocaleTimeString()}</time>
      </section>

      {data.board.preset === "next_match" &&
        (match ? (
          <section className="display-kiosk-panel">
            <article>
              <span>NEXT MATCH</span>
              <strong>{matchLabel(match.compLevel, match.matchNumber)}</strong>
              <small>
                {match.scheduledTime
                  ? new Date(match.scheduledTime).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })
                  : "Schedule time unavailable from the official schedule"}
              </small>
            </article>
            <article>
              <span>COUNTDOWN</span>
              <strong className={clock.queueSoon ? "queue-soon" : undefined}>{clock.label}</strong>
              <em className={clock.queueNow ? "queue-now" : clock.queueSoon ? "queue-soon" : clock.leavePit ? "leave" : undefined}>
                {queueCue(clock)}
              </em>
            </article>
            <article>
              <span>BUMPERS</span>
              <strong className={bumper === "red" ? "alliance-red" : bumper === "blue" ? "alliance-blue" : undefined}>
                {bumperBanner(bumper)}
              </strong>
              <small>{match.scheduledTime ? "From official alliance lists" : "No scheduled time; bumper still from alliance lists"}</small>
            </article>
            <article>
              <span>ALLIANCES</span>
              <p className="alliance-red">RED {formatAlliance(match.redAlliance?.teamKeys)}</p>
              <p className="alliance-blue">BLUE {formatAlliance(match.blueAlliance?.teamKeys)}</p>
            </article>
          </section>
        ) : (
          <section className="display-kiosk-empty">
            <span>NEXT MATCH</span>
            <h2>No upcoming team match</h2>
            <p>
              Set an active event and sync official matches. This board only shows matches that include team #
              {data.organization.teamNumber}. Queue time stays blank until those matches exist.
            </p>
          </section>
        ))}

      {data.board.preset === "win_prediction" &&
        (prediction && formatDisplayPrediction(prediction) !== "No grounded prediction" ? (
          <>
            <section className="display-kiosk-panel">
              <article>
                <span>WIN PREDICTION</span>
                <strong>
                  {predictionWinDisplay({
                    pRed: prediction.pRed,
                    alliance: "red",
                    modelVersion: prediction.modelVersion,
                    caveats: prediction.caveats,
                  })?.label ?? "—"}{" "}
                  RED
                </strong>
                <small>
                  Typical range {Math.round(prediction.confidenceLow * 100)}–
                  {Math.round(prediction.confidenceHigh * 100)}%
                </small>
              </article>
              <article>
                <span>BLUE</span>
                <strong>
                  {predictionWinDisplay({
                    pBlue: prediction.pBlue,
                    alliance: "blue",
                    modelVersion: prediction.modelVersion,
                    caveats: prediction.caveats,
                  })?.label ?? "—"}
                </strong>
                <em>Not an official result</em>
              </article>
              <article>
                <span>TOP FACTORS</span>
                {(prediction.keyFactors ?? []).slice(0, 3).map((factor) => (
                  <small key={factor.name}>
                    {factor.impact} · {factor.name}
                  </small>
                ))}
                {!(prediction.keyFactors ?? []).length ? (
                  <small>No key factors stored on this prediction.</small>
                ) : null}
              </article>
            </section>
            {data.strategyHeadline ? (
              <section className="display-kiosk-strategy">
                <span>STRATEGY</span>
                <strong>{data.strategyHeadline}</strong>
              </section>
            ) : null}
          </>
        ) : (
          <section className="display-kiosk-empty">
            <span>WIN PREDICTION</span>
            <h2>Awaiting a stored prediction</h2>
            <p>
              Open Strategy with a synced match and score a model prediction for this event. Until then this
              board stays blank.
            </p>
          </section>
        ))}

      {data.board.preset === "robot_readiness" &&
        (hasReadinessSignal(readiness) ? (
          <section className="display-kiosk-panel">
            <article>
              <span>ACTIVE BATTERIES</span>
              <strong>{readiness!.batteriesActive}</strong>
              <small>packs marked active in Pit</small>
            </article>
            <article>
              <span>IN SERVICE</span>
              <strong>{readiness!.batteriesService}</strong>
              <small>packs out of rotation</small>
            </article>
            <article>
              <span>OPEN FAILURES</span>
              <strong>{readiness!.openFailures}</strong>
              <small>unresolved robot failures</small>
            </article>
            <article>
              <span>OPEN MAINTENANCE</span>
              <strong>{readiness!.openMaintenance}</strong>
              <small>incomplete maintenance tasks</small>
            </article>
          </section>
        ) : (
          <section className="display-kiosk-empty">
            <span>ROBOT READINESS</span>
            <h2>Readiness data not logged yet</h2>
            <p>
              Battery fleet, failures, and maintenance stay blank until your team records them in Pit ops.
              Vantage will not show an assumed green checklist.
            </p>
          </section>
        ))}

      {data.board.preset === "event_command" &&
        (hasEventCommandSignal(data) ? (
          <section className="display-kiosk-panel">
            <article>
              <span>NEXT TEAM MATCH</span>
              <strong>{match ? matchLabel(match.compLevel, match.matchNumber) : "-"}</strong>
              <small>{match ? clock.label : "No upcoming match on the official schedule"}</small>
            </article>
            <article>
              <span>RANK</span>
              <strong>{rankLabel(data.eventStatus)}</strong>
              <small>
                {data.eventStatus?.source
                  ? `from ${data.eventStatus.source}`
                  : "Sync event numbers"}
              </small>
            </article>
            <article>
              <span>RECORD</span>
              <strong>{recordLabel(data.eventStatus)}</strong>
              <small>wins-losses{data.eventStatus?.ties ? "-ties" : ""}</small>
            </article>
            <article>
              <span>SCOUT ALERTS</span>
              <strong>{data.scouting.openDisagreements}</strong>
              <small>
                {error
                  ? error
                  : data.scouting.openDisagreements
                    ? "open disagreements"
                    : "No current display alerts"}
              </small>
            </article>
          </section>
        ) : (
          <section className="display-kiosk-empty">
            <span>EVENT COMMAND</span>
            <h2>Waiting on synced event data</h2>
            <p>
              Set an active event and sync official matches and event numbers. This board stays blank instead of
              inventing a rank, record, or next match.
            </p>
          </section>
        ))}

      {data.board.preset === "scouting_coverage" &&
        (hasScoutingCoverageSignal(data.scouting) ? (
          <section className="display-kiosk-panel">
            <article>
              <span>ASSIGNMENTS</span>
              <strong>{data.scouting.assignments}</strong>
              <small>at active event</small>
            </article>
            <article>
              <span>REPORTS</span>
              <strong>{data.scouting.reports}</strong>
              <small>synced observations</small>
            </article>
            <article>
              <span>REVIEW WARNINGS</span>
              <strong>{data.scouting.openDisagreements}</strong>
              <small>open disagreements</small>
            </article>
          </section>
        ) : (
          <section className="display-kiosk-empty">
            <span>SCOUTING COVERAGE</span>
            <h2>No scouting rows for this event</h2>
            <p>
              Assignments, reports, and disagreements appear only after Scouting records them at the
              active event.
            </p>
          </section>
        ))}

      {data.board.preset === "custom" && (
        <section className="display-kiosk-custom">
          {(data.board.widgets?.length ? data.board.widgets : [{ type: "-" }]).map((widget, index) => (
            <article key={`${widget.type}-${index}`}>
              <span>{String(widget.type).replaceAll("_", " ")}</span>
              <strong>
                {widget.type === "-"
                  ? "No widgets on this board"
                  : widgetValue(String(widget.type), data)}
              </strong>
            </article>
          ))}
        </section>
      )}

      <footer>
        <span>
          {mode === "pit"
            ? "Pit TV · tap to show controls · live snapshots only"
            : "Layout is fixed until changed in Display Mode setup."}
        </span>
        {error ? <strong className="kiosk-error">{error}</strong> : <span>Live refresh every 30s</span>}
      </footer>
    </main>
  );
}
