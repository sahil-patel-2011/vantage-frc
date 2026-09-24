/**
 * The match clock a scout starts with the field: which phase the match is in, and which
 * part of the form belongs to it. Standard FRC timing until the season manual says
 * otherwise: 15 s autonomous, then teleop to 2:30, the last 20 s of it endgame.
 */

export type MatchPhase = "pre" | "auto" | "teleop" | "endgame" | "done";

export type MatchTiming = { autoMs: number; teleopMs: number; endgameMs: number };

export const DEFAULT_TIMING: MatchTiming = { autoMs: 15_000, teleopMs: 135_000, endgameMs: 20_000 };

export function phaseAt(elapsedMs: number | null, timing: MatchTiming = DEFAULT_TIMING): MatchPhase {
  if (elapsedMs == null || elapsedMs < 0) return "pre";
  const end = timing.autoMs + timing.teleopMs;
  if (elapsedMs < timing.autoMs) return "auto";
  if (elapsedMs >= end) return "done";
  if (elapsedMs >= end - timing.endgameMs) return "endgame";
  return "teleop";
}

/** Seconds left in the current phase (endgame counts down to the buzzer). */
export function phaseRemainingSeconds(elapsedMs: number, timing: MatchTiming = DEFAULT_TIMING): number {
  const end = timing.autoMs + timing.teleopMs;
  const phase = phaseAt(elapsedMs, timing);
  const boundary =
    phase === "auto" ? timing.autoMs : phase === "teleop" ? end - timing.endgameMs : phase === "endgame" ? end : elapsedMs;
  return Math.max(0, Math.ceil((boundary - elapsedMs) / 1000));
}

export function clockLabel(elapsedMs: number): string {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

const PHASE_WORDS: Record<Exclude<MatchPhase, "pre" | "done">, RegExp> = {
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
