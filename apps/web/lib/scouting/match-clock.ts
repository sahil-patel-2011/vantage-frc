/**
 * The match clock a scout starts with the field: which phase the match is in, and which
 * part of the form belongs to it. Standard FRC timing until the season manual says
 * otherwise: 15 s autonomous, then teleop to 2:30, the last 20 s of it endgame.
 */

export type MatchPhase = "pre" | "auto" | "transition" | "teleop" | "endgame" | "done";

export type MatchTiming = { autoMs: number; teleopMs: number; endgameMs: number; transitionMs?: number };

export const DEFAULT_TIMING: MatchTiming = { autoMs: 15_000, teleopMs: 135_000, endgameMs: 20_000 };
// FIRST 2026 manual §6.4: 20s auto, 3s scoring pause, 140s teleop (last 30s endgame).
export function timingForSeason(year: number | null): MatchTiming {
  return year === 2026 ? { autoMs: 20_000, transitionMs: 3_000, teleopMs: 140_000, endgameMs: 30_000 } : DEFAULT_TIMING;
}

export function phaseAt(elapsedMs: number | null, timing: MatchTiming = DEFAULT_TIMING): MatchPhase {
  if (elapsedMs == null || elapsedMs < 0) return "pre";
  const teleopStart = timing.autoMs + (timing.transitionMs ?? 0);
  const end = teleopStart + timing.teleopMs;
  if (elapsedMs < timing.autoMs) return "auto";
  if (elapsedMs < teleopStart) return "transition";
  if (elapsedMs >= end) return "done";
  if (elapsedMs >= end - timing.endgameMs) return "endgame";
  return "teleop";
}

/** Seconds left in the current phase (endgame counts down to the buzzer). */
export function phaseRemainingSeconds(elapsedMs: number, timing: MatchTiming = DEFAULT_TIMING): number {
  const end = timing.autoMs + (timing.transitionMs ?? 0) + timing.teleopMs;
  const phase = phaseAt(elapsedMs, timing);
  const boundary =
    phase === "auto" ? timing.autoMs : phase === "transition" ? timing.autoMs + (timing.transitionMs ?? 0) : phase === "teleop" ? end - timing.endgameMs : phase === "endgame" ? end : elapsedMs;
  return Math.max(0, Math.ceil((boundary - elapsedMs) / 1000));
}

export function clockLabel(elapsedMs: number): string {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

const PHASE_WORDS: Record<Exclude<MatchPhase, "pre" | "done" | "transition">, RegExp> = {
  auto: /\bauto/i,
  teleop: /tele|driver/i,
  endgame: /end ?game|climb|park|hang|dock|barge|stage/i,
};

/**
 * The first form field for each phase, by its key or label ("Auto points", a "Teleop"
 * section header, "Endgame climb"). Phases the form has no field for are simply absent.
 */
export function phaseAnchors(fields: Array<{ key: string; label: string }>): Partial<Record<MatchPhase, string>> {
  const anchors: Partial<Record<MatchPhase, string>> = {};
  for (const phase of ["auto", "teleop", "endgame"] as const) {
    const hit = fields.find((field) => PHASE_WORDS[phase].test(`${field.key} ${field.label}`));
    if (hit) anchors[phase] = hit.key;
  }
  return anchors;
}
