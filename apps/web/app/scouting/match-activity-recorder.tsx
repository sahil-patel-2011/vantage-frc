"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { activeCaptureBout, CAPTURE_KINDS, correctCaptureBout, finishCaptureBout, matchCapture, restoreCaptureBout, setCaptureHubOrder, startCaptureBout, type CaptureKind, type MatchCapture } from "@vantage/scouting";
import { readScoutClock } from "../../lib/scouting/draft-autosave";
import { clockLabel, phaseAt, rebuiltShiftAt, timingForSeason } from "../../lib/scouting/match-clock";
import { ACTIVITY_LABELS, MatchActivityReport } from "./match-activity-report";
import styles from "./match-activity.module.css";

/** The same persisted clock as MatchTimer; reloads keep an unfinished interval intact. */
export function MatchActivityRecorder({ payload, setPayload, storageKey, alliance = null }: {
  payload: Record<string, unknown>; setPayload: Dispatch<SetStateAction<Record<string, unknown>>>; storageKey: string | null;
  alliance?: "red" | "blue" | null;
}) {
  const [clock, setClock] = useState<{ startedAt: number | null; now: number }>({ startedAt: null, now: 0 });
  const [error, setError] = useState("");
  useEffect(() => {
    const tick = () => setClock({ startedAt: readScoutClock(storageKey), now: Date.now() });
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [storageKey]);
  const capture = matchCapture(payload);
  const active = activeCaptureBout(capture);
  const elapsed = clock.startedAt === null ? null : Math.max(0, clock.now - clock.startedAt);
  const phase = phaseAt(elapsed, timingForSeason(2026));
  const shift = rebuiltShiftAt(elapsed, alliance, capture?.firstInactiveAlliance);
  const clockMatches = !capture || capture.clockStartedAt === clock.startedAt;
  function update(transform: (value: Record<string, unknown>) => Record<string, unknown>) {
    try { setPayload(transform(payload)); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update this activity."); }
  }
  // Auto-end an interval at the buzzer; unknown counts stay unknown until the scout enters one.
  useEffect(() => {
    if (phase === "done" && active && clockMatches) setPayload(current => finishCaptureBout(current, active.id, 163_000));
  }, [phase, active?.id, clockMatches, setPayload]);
  const latest = [...(capture?.bouts ?? [])].reverse().find(bout => !bout.voided && bout.endMs !== null && (bout.kind === "shooting" || bout.kind === "feeding"));
  const canStart = clock.startedAt !== null && phase !== "pre" && phase !== "transition" && phase !== "done" && clockMatches && !active;
  function start(kind: CaptureKind) {
    if (!canStart || elapsed === null || clock.startedAt === null) return;
    const elapsedMs = Math.max(0, Date.now() - clock.startedAt);
    const currentPhase = phaseAt(elapsedMs, timingForSeason(2026));
    if (currentPhase === "pre" || currentPhase === "transition" || currentPhase === "done") return;
    const input = { id: crypto.randomUUID(), kind, elapsedMs, clockStartedAt: clock.startedAt };
    update(current => startCaptureBout(current, input));
  }
  return <section className={styles.recorder} aria-label="Live match activity" data-live-match-recorder>
    <div className={styles.heading}><div><span className={styles.eyebrow}>Live observations</span><h3>What is the robot doing?</h3></div>
      <span className={styles.elapsed}>{elapsed === null ? "Start the match clock" : `${clockLabel(elapsed)} elapsed`}</span></div>
    <p className="app-muted">Tap when an activity starts, stop when it ends. Count fuel released in the bout if you could see it.</p>
    {elapsed !== null ? <div className={styles.shift}><strong>{shift.label} · {shift.secondsLeft}s</strong><span>{shift.hub === "unknown" ? "Hub status unconfirmed" : `Hub ${shift.hub}`}</span>
      {elapsed >= 23000 ? <label>FMS: first inactive hub<select aria-label="FMS: first inactive hub" value={capture?.firstInactiveAlliance ?? "unknown"} disabled={!clockMatches} onChange={event => {
        const firstInactive = event.target.value as NonNullable<MatchCapture["firstInactiveAlliance"]>;
        if (clock.startedAt !== null) update(current => setCaptureHubOrder(current, firstInactive, clock.startedAt!));
      }}><option value="unknown">Not confirmed</option><option value="red">Red</option><option value="blue">Blue</option></select></label> : null}
      {shift.hub === "inactive" ? <small>Fuel entering this hub does not score during this shift. You can still observe released fuel.</small> : null}
      {!alliance ? <small>Robot alliance is not on the schedule. Confirm hub lights at the field.</small> : null}
    </div> : null}
    <div className={styles.actions}>{CAPTURE_KINDS.map(kind => <button type="button" key={kind} disabled={!canStart} aria-pressed={active?.kind === kind} onClick={() => start(kind)}>{ACTIVITY_LABELS[kind]}</button>)}</div>
    {active ? <div className={styles.active}><strong>{ACTIVITY_LABELS[active.kind]} · {((Math.min(elapsed ?? active.startMs, 163_000) - active.startMs) / 1000).toFixed(1)}s</strong>
      <button type="button" disabled={!clockMatches || elapsed === null || elapsed <= active.startMs} onClick={() => {
        const stoppedAt = clock.startedAt === null ? active.startMs : Date.now() - clock.startedAt;
        update(current => finishCaptureBout(current, active.id, stoppedAt));
      }}>Stop {ACTIVITY_LABELS[active.kind].toLowerCase()}</button></div> : null}
    {latest ? <div className={styles.count}><label>Fuel released in last {latest.kind} bout<input type="number" inputMode="numeric" min={0} max={1000} step={1} value={latest.count ?? ""} placeholder="Not counted" onChange={event => {
      const count = event.target.value === "" ? null : Number(event.target.value);
      update(current => correctCaptureBout(current, latest.id, { count }));
    }} /></label><small>Enter 0 only if you observed zero. A blank count is excluded from throughput.</small></div> : null}
    {!clockMatches ? <p role="alert">These observations belong to a different clock. Return to the original report before recording more.</p> : null}
    {phase === "transition" ? <p className="app-muted">Scoring pause. Finish the current activity; start another when teleop begins.</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {capture?.bouts.length ? <details><summary data-disclosure>Correct an activity</summary><ul className={styles.corrections}>{capture.bouts.map(bout => <li key={bout.id}>
      <span>{clockLabel(bout.startMs)} · {ACTIVITY_LABELS[bout.kind]}{bout.voided ? " · removed" : ""}</span>
      {!bout.voided && bout.endMs !== null && (bout.kind === "shooting" || bout.kind === "feeding") ? <label className={styles.compactLabel}>Fuel<input aria-label={`Fuel released at ${clockLabel(bout.startMs)}`} type="number" min={0} max={1000} step={1} value={bout.count ?? ""} placeholder="Unknown" onChange={event => update(current => correctCaptureBout(current, bout.id, { count: event.target.value === "" ? null : Number(event.target.value) }))} /></label> : null}
      <button type="button" onClick={() => update(current => bout.voided ? restoreCaptureBout(current, bout.id) : correctCaptureBout(current, bout.id, { voided: true }))}>{bout.voided ? "Restore" : "Remove"}</button>
    </li>)}</ul></details> : null}
    {capture?.bouts.length ? <details><summary data-disclosure>Review recorded activity</summary><MatchActivityReport payload={payload} /></details> : null}
  </section>;
}
