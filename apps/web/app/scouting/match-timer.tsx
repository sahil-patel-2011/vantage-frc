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

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The form's own Save button does the saving, so its checks and messages stay in one place. */
function saveFromTimer() {
  const save = document.querySelector<HTMLButtonElement>(".scout-save-button");
  if (!save) return;
  save.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center" });
  if (save.disabled) save.focus();
  else save.click();
}

/**
 * Start it when the field starts. The phase follows the clock, and the form scrolls to the
 * part for that phase (auto, then teleop, then endgame) and outlines it, so a scout's eyes
 * stay on the field and their thumb finds the right counters. When the match ends the bar
 * becomes "Save this match" and the form scrolls to its last answers. Restarting is one tap.
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

  const elapsed = startedAt == null ? null : now - startedAt;
  const phase = phaseAt(elapsed);
  const done = phase === "done";

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
    const key = anchors[phase];
    if (!key) return;
    const target = document.getElementById(`scout-field-${encodeURIComponent(key)}`);
    if (!target) return;
    target.classList.add("scout-phase-current");
    target.scrollIntoView({ behavior, block: "start" });
  }, [phase, anchors]);

  const secondsLeft = elapsed == null || done ? 0 : phaseRemainingSeconds(elapsed);

  return (
    <div className="match-timer" role="timer" aria-live="off">
      <span className="match-timer-phase" data-phase={phase}>
        {PHASE_LABEL[phase]}
      </span>
      {elapsed != null ? (
        <>
          {done ? (
            <button type="button" className="start" onClick={saveFromTimer}>
              Save this match
            </button>
          ) : (
            // Time left in this phase is what a scout needs; time elapsed is arithmetic.
            <span className="match-timer-clock" aria-label={`${secondsLeft} seconds left in ${PHASE_LABEL[phase]}`}>
              {clockLabel(secondsLeft * 1000)}
            </span>
          )}
          <button type="button" onClick={() => setStartedAt(null)}>
            {done ? "Restart" : "Reset"}
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
