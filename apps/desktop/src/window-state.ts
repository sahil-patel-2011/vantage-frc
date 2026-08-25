/** Persisted window bounds with clamping so a restored window is always visible. */

export type WindowState = {
  width: number;
  height: number;
  x?: number;
  y?: number;
  maximized?: boolean;
};

export type DisplayRect = { x: number; y: number; width: number; height: number };

export const DEFAULT_WINDOW_STATE: WindowState = { width: 1440, height: 920 };
export const MIN_WINDOW_WIDTH = 1024;
export const MIN_WINDOW_HEIGHT = 720;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function intersects(state: { x: number; y: number; width: number; height: number }, display: DisplayRect): boolean {
  // Require a meaningful sliver (32px) inside the display so the title bar is grabbable.
  const overlapX =
    Math.min(state.x + state.width, display.x + display.width) - Math.max(state.x, display.x);
  const overlapY =
    Math.min(state.y + state.height, display.y + display.height) - Math.max(state.y, display.y);
  return overlapX >= 32 && overlapY >= 32;
}

/**
 * Turn whatever was persisted (possibly corrupt, possibly from an unplugged
 * monitor) into a usable window state. Position is dropped — not the whole
 * state — when it no longer lands on any current display.
 */
export function sanitizeWindowState(raw: unknown, displays: DisplayRect[]): WindowState {
  if (typeof raw !== "object" || raw === null) return { ...DEFAULT_WINDOW_STATE };
  const candidate = raw as Record<string, unknown>;

  const width = isFiniteNumber(candidate.width)
    ? Math.max(MIN_WINDOW_WIDTH, Math.round(candidate.width))
    : DEFAULT_WINDOW_STATE.width;
  const height = isFiniteNumber(candidate.height)
    ? Math.max(MIN_WINDOW_HEIGHT, Math.round(candidate.height))
    : DEFAULT_WINDOW_STATE.height;

  const state: WindowState = { width, height };
  if (candidate.maximized === true) state.maximized = true;

  if (isFiniteNumber(candidate.x) && isFiniteNumber(candidate.y)) {
    const x = Math.round(candidate.x);
    const y = Math.round(candidate.y);
    if (displays.some((display) => intersects({ x, y, width, height }, display))) {
      state.x = x;
      state.y = y;
    }
  }
  return state;
}

export function serializeWindowState(state: WindowState): string {
  return JSON.stringify(state);
}

export function parseWindowState(raw: string | undefined, displays: DisplayRect[]): WindowState {
  if (!raw) return { ...DEFAULT_WINDOW_STATE };
  try {
    return sanitizeWindowState(JSON.parse(raw), displays);
  } catch {
    return { ...DEFAULT_WINDOW_STATE };
  }
}
