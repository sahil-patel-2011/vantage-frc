"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { clockLabel, phaseAnchors, phaseAt, phaseRemainingSeconds, timingForSeason, type MatchPhase } from "../../lib/scouting/match-clock";
import { readScoutClock, writeScoutClock } from "../../lib/scouting/draft-autosave";
import { TabBar } from "../../components/ui";

import { type ScoutFormStage } from "../../lib/scouting/match-form-flow";

const STAGE_LABEL: Record<ScoutFormStage, string> = { all: "All", pre: "Before match", auto: "Auto", teleop: "Teleop", endgame: "Endgame", review: "Review" };

const PHASE_LABEL: Record<MatchPhase, string> = {
  pre: "Match timer",
  auto: "Auto",
  transition: "Scoring pause",
  teleop: "Teleop",
  endgame: "Endgame",
  done: "Match over",
};

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Start it when the field starts. The phase follows the clock, and the form scrolls to the
 * part for that phase (auto, then teleop, then endgame) and outlines it, so a scout's eyes
 * stay on the field and their thumb finds the right counters. When the match ends the bar
 * reports that review is ready. The form's single action bar handles saving.
 */
export function MatchTimer({ fields, resetKey, storageKey, onStarted, seasonYear = null, stage = "all", onStageChange, onPhaseChange, undoButton, resetDisabled = false, showControls = true }: {
  stage?: ScoutFormStage; onStageChange?: (stage: ScoutFormStage) => void; onPhaseChange?: (phase: MatchPhase) => void; undoButton?: ReactNode;
  fields: Array<{ key: string; label: string }>; resetKey: string; storageKey: string | null; onStarted?: () => void; seasonYear?: number | null; resetDisabled?: boolean; showControls?: boolean;
}) {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const anchors = useMemo(() => phaseAnchors(fields), [fields]);
  const lastPhase = useRef<MatchPhase>("pre");
  const phaseCallback = useRef(onPhaseChange);
  phaseCallback.current = onPhaseChange;

  // A new robot or match is a new clock.
  useEffect(() => {
    setStartedAt(readScoutClock(storageKey));
    setNow(Date.now());
    lastPhase.current = "pre";
    phaseCallback.current?.("pre");
  }, [resetKey, storageKey]);

  const elapsed = startedAt == null ? null : now - startedAt;
  const timing = timingForSeason(seasonYear);
  const phase = phaseAt(elapsed, timing);
  const done = phase === "done";

  useEffect(() => { phaseCallback.current?.(phase); }, [phase]);

  // Save asks "still running?" while the clock is in the match (see scouting-ready-view).
  const running = startedAt != null && !done;
  useEffect(() => {
    if (running) document.documentElement.dataset.scoutTimer = "running";
    else delete document.documentElement.dataset.scoutTimer;
    return () => {
      delete document.documentElement.dataset.scoutTimer;
    };
  }, [running]);

  useEffect(() => {
    // Once the match is over there is nothing left to count, and the phone keeps its battery.
    if (startedAt == null || done) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [startedAt, done]);

  useEffect(() => {
    if (phase === lastPhase.current) return;
    lastPhase.current = phase;
    document.querySelectorAll(".scout-phase-current").forEach((node) => node.classList.remove("scout-phase-current"));
    const behavior = prefersReducedMotion() ? "auto" : "smooth";
    if (phase === "done") {
      // Broke down, notes and Save sit at the end of the form: take the scout there.
      document.querySelector(".scout-save-button")?.scrollIntoView({ behavior, block: "center" });
      return;
    }
    const recorder = document.querySelector<HTMLElement>("[data-live-match-recorder]");
    if (recorder) { recorder.scrollIntoView({ behavior, block: "start" }); return; }
    const key = anchors[phase];
    if (!key) return;
    const target = document.getElementById(`scout-field-${encodeURIComponent(key)}`);
    if (!target) return;
    target.classList.add("scout-phase-current");
    target.scrollIntoView({ behavior, block: "start" });
  }, [phase, anchors]);

  const secondsLeft = elapsed == null || done ? 0 : phaseRemainingSeconds(elapsed, timing);

  return (
    <div><div className="match-timer" role="timer" aria-live="off" data-running={elapsed != null && !done ? "true" : "false"}>
      {/* Before the start the button says what this is; a grey "Match timer" pill beside it
          looked like a second button. */}
      {elapsed != null ? (
        <span className="match-timer-phase" data-phase={phase}>
          {PHASE_LABEL[phase]}
        </span>
      ) : null}
      {elapsed != null ? (
        <>
          {done ? (
            <span className="match-timer-finished">Ready to review</span>
          ) : (
            // Time left in this phase is what a scout needs; time elapsed is arithmetic.
            <span className="match-timer-clock" aria-label={`${secondsLeft} seconds left in ${PHASE_LABEL[phase]}`}>
              {clockLabel(secondsLeft * 1000)}
            </span>
          )}
          <button type="button" disabled={resetDisabled} title={resetDisabled ? "Recorded activity uses this clock. Start a new report for a new match." : undefined} onClick={() => { writeScoutClock(storageKey, null); setStartedAt(null); }}>
            {done ? "Restart" : "Reset"}
          </button>
        </>
      ) : (
        <button type="button" className="start" aria-label="Start match timer when auto starts" onClick={() => {
          const start = Date.now(); setNow(start); setStartedAt(start); writeScoutClock(storageKey, start); onStarted?.();
        }}>
          {/* Says what it is and when to press it; "Start with the field" read as a place. */}
          Start match
        </button>
      )}
    </div>
    {showControls ? <MatchFormControls stage={stage} onStageChange={onStageChange} undoButton={undoButton} /> : null}
    {seasonYear !== 2026 ? <small className="app-muted">Practice timing: 15s auto / 135s teleop. Follow the field clock.</small> : null}
    </div>
  );
}

/** Phase navigation stays in normal flow, so it never covers the live input on a phone. */
export function MatchFormControls({ stage, onStageChange, undoButton }: { stage: ScoutFormStage; onStageChange?: (stage: ScoutFormStage) => void; undoButton?: ReactNode }) {
  return <div className="scout-phase-controls">
      <TabBar className="scout-phase-tabs" aria-label="Match form section" value={stage === "all" ? "review" : stage} onChange={id => onStageChange?.(id as ScoutFormStage)}
        tabs={(["pre", "auto", "teleop", "endgame", "review"] as const).map(key => ({ id: key, label: STAGE_LABEL[key] }))} />{undoButton}
    </div>;
}
