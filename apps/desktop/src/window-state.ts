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

  const placed =
    isFiniteNumber(candidate.x) && isFiniteNumber(candidate.y)
      ? { x: Math.round(candidate.x), y: Math.round(candidate.y) }
      : null;
  const home = placed
    ? displays.find((display) => intersects({ x: placed.x, y: placed.y, width, height }, display))
    : undefined;

  if (home && placed) {
    const fitted = fitInside(home, width, height, placed.x, placed.y);
    state.width = fitted.width;
    state.height = fitted.height;
    state.x = fitted.x;
    state.y = fitted.y;
    return state;
  }

  const capped = capToLargest(displays, width, height);
  state.width = capped.width;
  state.height = capped.height;
  return state;
}

/** Keep the window inside one display, including a 1366-wide pit laptop. */
function fitInside(
  display: DisplayRect,
  width: number,
  height: number,
  x: number,
  y: number,
): { width: number; height: number; x: number; y: number } {
  const fittedWidth = Math.min(width, Math.max(1, display.width));
  const fittedHeight = Math.min(height, Math.max(1, display.height));
  const maxX = display.x + display.width - fittedWidth;
  const maxY = display.y + display.height - fittedHeight;
  return {
    width: fittedWidth,
    height: fittedHeight,
    x: Math.min(Math.max(x, display.x), maxX),
    y: Math.min(Math.max(y, display.y), maxY),
  };
}

function capToLargest(
  displays: DisplayRect[],
  width: number,
  height: number,
): { width: number; height: number } {
  if (!displays.length) return { width, height };
  const maxWidth = Math.max(...displays.map((display) => display.width));
  const maxHeight = Math.max(...displays.map((display) => display.height));
  return {
    width: Math.min(width, Math.max(1, maxWidth)),
    height: Math.min(height, Math.max(1, maxHeight)),
  };
}

export function serializeWindowState(state: WindowState): string {
  return JSON.stringify(state);
}

export function parseWindowState(raw: string | undefined, displays: DisplayRect[]): WindowState {
  if (!raw) return sanitizeWindowState(DEFAULT_WINDOW_STATE, displays);
  try {
    return sanitizeWindowState(JSON.parse(raw), displays);
  } catch {
    return sanitizeWindowState(DEFAULT_WINDOW_STATE, displays);
  }
}
