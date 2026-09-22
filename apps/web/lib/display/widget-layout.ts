/**
 * Arranging a pit display.
 *
 * A board used to be a preset and nothing else: pick one of five, get a fixed
 * pair of panels in a fixed order, and if the thing your team stares at all
 * weekend is second rather than first, that is simply how it is. On a screen
 * across a pit, order is not decoration — the top-left panel is the one people
 * read from six feet away, and every team wants a different one there.
 *
 * So presets stay exactly as they are, as the thing you start from, and this
 * lets a team move, add and remove from there.
 *
 * All of it is pure list arithmetic, which matters more than it sounds: the
 * grid positions used to be computed inline at save time, so the only way to
 * find out what a layout would look like was to save it and go and look at a
 * television.
 */

import {
  DISPLAY_WIDGET_TYPES,
  PRESET_WIDGETS,
  type DisplayWidget,
  type DisplayWidgetType,
} from "../display";

/** Columns in the board grid. Two panels across is what reads at pit distance. */
export const BOARD_COLUMNS = 12;
const WIDGET_WIDTH = 6;
const WIDGET_HEIGHT = 4;

/** A board with nothing on it shows nothing, so the editor refuses to save one. */
export const MIN_WIDGETS = 1;

/**
 * More than this and each panel is too small to read across a room, which is
 * the entire purpose of the screen.
 */
export const MAX_WIDGETS = 6;

export const WIDGET_LABEL: Record<DisplayWidgetType, string> = {
  next_match: "Next match",
  prediction: "Win prediction",
  strategy: "Strategy headline",
  robot_readiness: "Robot readiness",
  event_status: "Event status",
  scouting_coverage: "Scouting coverage",
  alerts: "Alerts",
  team_intel: "Team intel",
};

export function isWidgetType(value: unknown): value is DisplayWidgetType {
  return typeof value === "string" && (DISPLAY_WIDGET_TYPES as readonly string[]).includes(value);
}

/** Keep only real widget types, in order, with no repeats. */
export function normalizeWidgets(values: readonly unknown[]): DisplayWidgetType[] {
  const seen = new Set<DisplayWidgetType>();
  const out: DisplayWidgetType[] = [];
  for (const value of values) {
    if (!isWidgetType(value) || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out.slice(0, MAX_WIDGETS);
}

/**
 * Move one widget from one position to another.
 *
 * Out-of-range indices return the list untouched rather than throwing or
 * clamping: a drag that ended outside the list is a cancelled drag, and
 * clamping would silently move the panel somewhere nobody asked for.
 */
export function reorderWidgets(
  widgets: readonly DisplayWidgetType[],
  from: number,
  to: number,
): DisplayWidgetType[] {
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to < 0 ||
    from >= widgets.length ||
    to >= widgets.length ||
    from === to
  ) {
    return [...widgets];
  }
  const next = [...widgets];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

/**
 * Nudge a widget one place.
 *
 * Exists so the editor works from a keyboard. A drag-only reorder is
 * unusable with a keyboard or a screen reader, and this is a page a mentor
 * might well be driving from a laptop trackpad in a noisy pit anyway.
 */
export function nudgeWidget(
  widgets: readonly DisplayWidgetType[],
  type: DisplayWidgetType,
  direction: "up" | "down",
): DisplayWidgetType[] {
  const index = widgets.indexOf(type);
  if (index < 0) return [...widgets];
  return reorderWidgets(widgets, index, direction === "up" ? index - 1 : index + 1);
}

/** Append a widget. Already present, or the board is full, means no change. */
export function addWidget(
  widgets: readonly DisplayWidgetType[],
  type: DisplayWidgetType,
): DisplayWidgetType[] {
  if (widgets.includes(type) || widgets.length >= MAX_WIDGETS) return [...widgets];
  return [...widgets, type];
}

/** Remove a widget, unless it is the last one — an empty board shows nothing. */
export function removeWidget(
  widgets: readonly DisplayWidgetType[],
  type: DisplayWidgetType,
): DisplayWidgetType[] {
  if (widgets.length <= MIN_WIDGETS) return [...widgets];
  return widgets.filter((widget) => widget !== type);
}

/** Widgets not on the board yet, in catalogue order, for the add menu. */
export function availableWidgets(
  widgets: readonly DisplayWidgetType[],
): DisplayWidgetType[] {
  return DISPLAY_WIDGET_TYPES.filter((type) => !widgets.includes(type));
}

/**
 * Turn the ordered list into grid positions.
 *
 * Two across, reading order, which is how the board has always been laid out —
 * this just moves the arithmetic somewhere it can be tested instead of running
 * inline at save time where the only way to check it was to look at a
 * television.
 */
export function toGridLayout(widgets: readonly DisplayWidgetType[]): DisplayWidget[] {
  return widgets.map((type, index) => ({
    type,
    x: (index % 2) * WIDGET_WIDTH,
    y: Math.floor(index / 2) * WIDGET_HEIGHT,
    w: WIDGET_WIDTH,
    h: WIDGET_HEIGHT,
  }));
}

/** Read a saved board back into an ordered list, ignoring positions. */
export function fromGridLayout(widgets: readonly DisplayWidget[]): DisplayWidgetType[] {
  return normalizeWidgets(widgets.map((widget) => widget.type));
}

/**
 * Whether this board is still exactly what the preset gives you.
 *
 * Used so the editor can say "customised" rather than leaving a team wondering
 * whether their changes took.
 */
export function matchesPreset(
  widgets: readonly DisplayWidgetType[],
  preset: string,
): boolean {
  const base = PRESET_WIDGETS[preset];
  if (!base) return false;
  if (base.length !== widgets.length) return false;
  return base.every((type, index) => widgets[index] === type);
}

/** Why a board cannot be saved, or null when it can. */
export function layoutProblem(widgets: readonly DisplayWidgetType[]): string | null {
  if (widgets.length < MIN_WIDGETS) return "A board needs at least one panel on it.";
  if (widgets.length > MAX_WIDGETS) {
    return `A board holds up to ${MAX_WIDGETS} panels — more than that and none of them read across a pit.`;
  }
  return null;
}
