"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { clockLabel, phaseAnchors, phaseAt, phaseRemainingSeconds, type MatchPhase } from "../../lib/scouting/match-clock";

const PHASE_LABEL: Record<MatchPhase, string> = {
  pre: "Before the match",
  auto: "Auto",
  teleop: "Teleop",
  endgame: "Endgame",
  done: "Match over",
};

/**
 * Start it when the field starts. The phase follows the clock, and the form scrolls to the
 * part for that phase (auto, then teleop, then endgame) and outlines it, so a scout's eyes
 * stay on the field and their thumb finds the right counters. Restarting is one tap.
 */
export function MatchTimer({ fields, resetKey }: { fields: Array<{ key: string; label: string }>; resetKey: string }) {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const anchors = useMemo(() => phaseAnchors(fields), [fields]);
  const lastPhase = useRef<MatchPhase>("pre");

  // A new robot or match is a new clock.
  useEffect(() => {
    setStartedAt(null);
    lastPhase.current = "pre";
  }, [resetKey]);

  useEffect(() => {
    if (startedAt == null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  const elapsed = startedAt == null ? null : now - startedAt;
  const phase = phaseAt(elapsed);

  useEffect(() => {
    if (phase === lastPhase.current) return;
    lastPhase.current = phase;
    document.querySelectorAll(".scout-phase-current").forEach((node) => node.classList.remove("scout-phase-current"));
    const key = anchors[phase];
    if (!key) return;
    const target = document.getElementById(`scout-field-${encodeURIComponent(key)}`);
    if (!target) return;
    target.classList.add("scout-phase-current");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }, [phase, anchors]);

  return (
    <div className="match-timer" role="timer" aria-live="off">
      <span className="match-timer-phase" data-phase={phase}>
        {PHASE_LABEL[phase]}
      </span>
      {elapsed != null ? (
        <>
          <span className="match-timer-clock">{clockLabel(elapsed)}</span>
          {phase !== "done" ? <small className="app-muted">{phaseRemainingSeconds(elapsed)} s left</small> : null}
          <button type="button" onClick={() => setStartedAt(null)}>
            Reset
          </button>
        </>
      ) : (
        <button type="button" className="start" onClick={() => { setNow(Date.now()); setStartedAt(Date.now()); }}>
          Start with the field
        </button>
      )}
    </div>
  );
}
