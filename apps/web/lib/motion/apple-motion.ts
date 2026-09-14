/**
 * Soft, Apple-like motion. Felt more than noticed: short fades, a few pixels
 * of rise, no bounce. Every helper is a no-op when the person asked for less
 * motion.
 */

export const MOTION_DURATION_FAST_MS = 160;
export const MOTION_DURATION_MS = 240;
export const MOTION_DURATION_SLOW_MS = 360;
export const MOTION_RISE_PX = 6;
export const MOTION_PRESS_SCALE = 0.985;
export const MOTION_STAGGER_MS = 28;
export const MOTION_EASE_OUT = "cubic-bezier(0.22, 1, 0.36, 1)";
export const MOTION_EASE_IN_OUT = "cubic-bezier(0.45, 0, 0.55, 1)";

export type MotionLevel = "full" | "reduce";

export type MotionTokens = {
  level: MotionLevel;
  durationFastMs: number;
  durationMs: number;
  durationSlowMs: number;
  risePx: number;
  pressScale: number;
  staggerMs: number;
  easeOut: string;
  easeInOut: string;
};

export function motionLevelFromPreference(prefersReducedMotion: boolean): MotionLevel {
  return prefersReducedMotion ? "reduce" : "full";
}

export function motionTokens(level: MotionLevel): MotionTokens {
  if (level === "reduce") {
    return {
      level,
      durationFastMs: 0,
      durationMs: 0,
      durationSlowMs: 0,
      risePx: 0,
      pressScale: 1,
      staggerMs: 0,
      easeOut: "linear",
      easeInOut: "linear",
    };
  }
  return {
    level,
    durationFastMs: MOTION_DURATION_FAST_MS,
    durationMs: MOTION_DURATION_MS,
    durationSlowMs: MOTION_DURATION_SLOW_MS,
    risePx: MOTION_RISE_PX,
    pressScale: MOTION_PRESS_SCALE,
    staggerMs: MOTION_STAGGER_MS,
    easeOut: MOTION_EASE_OUT,
    easeInOut: MOTION_EASE_IN_OUT,
  };
}

export function staggerDelayMs(index: number, level: MotionLevel, maxItems = 8): number {
  if (level === "reduce") return 0;
  const clamped = Math.min(Math.max(0, Math.trunc(index)), maxItems);
  return clamped * MOTION_STAGGER_MS;
}

export function motionStyleVars(tokens: MotionTokens): Record<string, string> {
  return {
    "--motion-fast": `${tokens.durationFastMs}ms`,
    "--motion": `${tokens.durationMs}ms`,
    "--motion-slow": `${tokens.durationSlowMs}ms`,
    "--motion-rise": `${tokens.risePx}px`,
    "--motion-press": String(tokens.pressScale),
    "--motion-ease": tokens.easeOut,
    "--motion-ease-io": tokens.easeInOut,
  };
}

/** CSS class set used by product pages. Empty when motion is reduced. */
export function motionClassNames(level: MotionLevel): {
  page: string;
  card: string;
  tile: string;
  press: string;
} {
  if (level === "reduce") {
    return { page: "motion-static", card: "motion-static", tile: "motion-static", press: "motion-static" };
  }
  return {
    page: "motion-page",
    card: "motion-card",
    tile: "motion-tile",
    press: "motion-press",
  };
}

export function parsePrefersReducedMotion(value: string | null | undefined): boolean {
  return value === "reduce";
}
