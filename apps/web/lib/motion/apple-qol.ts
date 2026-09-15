/**
 * Super-small Apple-like QoL motion. Felt, not noticed: 160/240/360ms,
 * 6px rise, 0.985 press, no bounce. Reduce = no motion.
 */

export const QOL_FAST_MS = 160;
export const QOL_MS = 240;
export const QOL_SLOW_MS = 360;
export const QOL_RISE_PX = 6;
export const QOL_PRESS = 0.985;
export const QOL_STAGGER_MS = 28;
export const QOL_HAIRLINE = 0.4;
export const QOL_FOCUS_PX = 4;
export const QOL_TILE_RISE_PX = 3;
export const QOL_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
export const QOL_EASE_IO = "cubic-bezier(0.45, 0, 0.55, 1)";

export type QolLevel = "full" | "reduce";

export type QolTokens = {
  level: QolLevel;
  fastMs: number;
  durationMs: number;
  slowMs: number;
  risePx: number;
  press: number;
  staggerMs: number;
  hairline: number;
  focusPx: number;
  tileRisePx: number;
  ease: string;
  easeIo: string;
};

export function qolLevelFromPreference(prefersReducedMotion: boolean): QolLevel {
  return prefersReducedMotion ? "reduce" : "full";
}

export function qolTokens(level: QolLevel): QolTokens {
  if (level === "reduce") {
    return {
      level,
      fastMs: 0,
      durationMs: 0,
      slowMs: 0,
      risePx: 0,
      press: 1,
      staggerMs: 0,
      hairline: 0,
      focusPx: 0,
      tileRisePx: 0,
      ease: "linear",
      easeIo: "linear",
    };
  }
  return {
    level,
    fastMs: QOL_FAST_MS,
    durationMs: QOL_MS,
    slowMs: QOL_SLOW_MS,
    risePx: QOL_RISE_PX,
    press: QOL_PRESS,
    staggerMs: QOL_STAGGER_MS,
    hairline: QOL_HAIRLINE,
    focusPx: QOL_FOCUS_PX,
    tileRisePx: QOL_TILE_RISE_PX,
    ease: QOL_EASE,
    easeIo: QOL_EASE_IO,
  };
}

export function qolStaggerMs(index: number, level: QolLevel, maxItems = 8): number {
  if (level === "reduce") return 0;
  return Math.min(Math.max(0, Math.trunc(index)), maxItems) * QOL_STAGGER_MS;
}

export function qolStyleVars(tokens: QolTokens): Record<string, string> {
  return {
    "--qol-fast": `${tokens.fastMs}ms`,
    "--qol": `${tokens.durationMs}ms`,
    "--qol-slow": `${tokens.slowMs}ms`,
    "--qol-rise": `${tokens.risePx}px`,
    "--qol-press": String(tokens.press),
    "--qol-ease": tokens.ease,
    "--qol-ease-io": tokens.easeIo,
    "--qol-hairline": `${tokens.hairline}px`,
    "--qol-focus": `${tokens.focusPx}px`,
    "--qol-tile-rise": `${tokens.tileRisePx}px`,
    "--qol-stagger": `${tokens.staggerMs}ms`,
  };
}

export function qolClassNames(level: QolLevel): {
  page: string;
  lift: string;
  press: string;
} {
  if (level === "reduce") {
    return { page: "", lift: "", press: "" };
  }
  return { page: "qol-page", lift: "qol-lift", press: "qol-press" };
}

export function parseQolReduced(value: string | null | undefined): boolean {
  return value === "reduce";
}
