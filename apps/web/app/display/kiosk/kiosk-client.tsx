"use client";

import "../../product-styles";
import { useCallback, useEffect, useState } from "react";
import {
  PRESET_WIDGETS,
  countdownState,
  hasEventCommandSignal,
  hasReadinessSignal,
  hasScoutingCoverageSignal,
  matchLabel,
  rankLabel,
  recordLabel,
  formatDisplayPrediction,
  kioskEventCommandEmptyCopy,
  type DisplaySnapshot,
  type DisplayWidget,
} from "../../../lib/display";
import { kioskBrandLine, kioskHeroSplit } from "../../../lib/display/kiosk-view";
import { type DisplayMatchIntel, toDisplayMatchIntel } from "../../../lib/display/match-intel";
import { predictionWinDisplay } from "../../../lib/strategy/prediction-display";
import { KioskPanel } from "./kiosk-panels";

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
  const [intel, setIntel] = useState<DisplayMatchIntel | null>(null);

  // What the team already knows about the next match (opponent tendencies from scouting),
  // for the lineup and the Team intel panel. Fetched when the next match changes.
  const nextMatch = data?.nextMatch ?? null;
  const nextMatchKey = nextMatch?.matchKey ?? null;
  const ownKey = data?.organization?.teamNumber ? `frc${data.organization.teamNumber}` : null;
  useEffect(() => {
    if (!nextMatchKey || !nextMatch) {
      setIntel(null);
      return;
    }
    const access = params.token
      ? `token=${encodeURIComponent(params.token)}`
      : params.orgId
        ? `orgId=${encodeURIComponent(params.orgId)}`
        : "";
    if (!access) return;
    let active = true;
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
              ? "If this keeps failing, the TV link was turned off. Make a new one on the Pit TV page."
              : "If this keeps failing, the TV link was turned off. Make a new one on the Pit TV page."
            : "Open a saved board from the Pit TV page."}
        </p>
        <button type="button" onClick={() => void refresh()}>
          Retry
        </button>
      </main>
    );
  }

  const match = data.nextMatch;
  // Only odds for the match that is actually next; the snapshot can fall back to an old one.
  const prediction =
    data.prediction && data.nextMatch && data.prediction.matchKey === data.nextMatch.matchKey ? data.prediction : null;
  const clock = countdownState(match?.scheduledTime, now);
  const eventName = data.activeEvent?.name ?? null;
  const readiness = data.readiness;
  // A team-built board and the "Next match" preset share one layout: panel 1 large on the
  // left, the rest stacked beside it, so adding a panel never shrinks the countdown.
  const heroBoard = data.board.preset === "custom" || data.board.preset === "next_match";
  const boardWidgets: DisplayWidget[] = data.board.widgets?.length
    ? data.board.widgets
    : (PRESET_WIDGETS[data.board.preset] ?? []).map((type) => ({ type }));
  const { hero, rest } = kioskHeroSplit(boardWidgets);

  return (
    <main
      className={`display-kiosk preset-${data.board.preset}${heroBoard ? " has-hero" : ""}${mode === "pit" ? " display-kiosk-pit" : ""}${mode === "pit" && chromeVisible ? " is-chrome" : ""}`}
      onPointerDown={() => {
        if (mode === "pit") setChromeVisible(true);
      }}
    >
      <header>
        <div className="kiosk-brand">
          <span>PIT TV</span>
          <strong>{kioskBrandLine(data.organization, eventName)}</strong>
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
          <span>{eventName ?? "No event set yet"}</span>
          <h1>{data.board.name}</h1>
        </div>
        <time dateTime={data.updatedAt}>Updated {new Date(data.updatedAt).toLocaleTimeString()}</time>
      </section>

      {heroBoard ? (
        <section className={`display-kiosk-hero${rest.length ? "" : " is-single"}`} aria-label="Board panels">
          {hero ? <KioskPanel type={String(hero.type)} data={data} now={now} intel={intel} hero /> : null}
          {rest.length ? (
            <div className="display-kiosk-stack" data-count={rest.length}>
              {rest.map((widget, index) => (
                <KioskPanel key={`${widget.type}-${index}`} type={String(widget.type)} data={data} now={now} intel={intel} hero={false} />
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

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
              <small>{match ? clock.label : "No upcoming match posted"}</small>
            </article>
            <article>
              <span>RANK</span>
              <strong>{rankLabel(data.eventStatus)}</strong>
              <small>
                {data.eventStatus?.source
                  ? `from ${data.eventStatus.source}`
                  : "No ratings saved"}
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
            <p>{kioskEventCommandEmptyCopy()}</p>
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

      <footer>
        <span>
          {mode === "pit"
            ? "Pit TV · tap the screen to show the controls"
            : "Change what this board shows on the Pit TV page."}
        </span>
        {error ? <strong className="kiosk-error">{error}</strong> : <span>Live refresh every 30s</span>}
      </footer>
    </main>
  );
}
