/**
 * Pure helpers for editing Home: the widget sheet's groups and search, the
 * draft's undo history, "are there unsaved changes", and which cards the
 * normal view hides. DOM-free so it runs under vitest in node.
 */

import {
  findDashboardSlot,
  homeViewLayout,
  isAlwaysShown,
  packDashboardLayout,
  type DashboardWidgetLayout,
  type DashboardWidgetType,
  type WidgetCatalogEntry,
} from "./catalog";

export type WidgetGroup = "match_day" | "team" | "build" | "me";

export const WIDGET_GROUP_ORDER: readonly WidgetGroup[] = ["match_day", "team", "build", "me"];

export const WIDGET_GROUP_LABEL: Record<WidgetGroup, string> = {
  match_day: "Match day",
  team: "Team",
  build: "Build",
  me: "Me",
};

/*
  One home per widget, typed as a full Record so a new widget type fails the
  type-check until someone decides where it belongs — otherwise it would
  silently vanish from the sheet.
*/
export const WIDGET_GROUP: Record<DashboardWidgetType, WidgetGroup> = {
  next_match: "match_day",
  match_schedule: "match_day",
  recent_result: "match_day",
  prediction_summary: "match_day",
  competition_snapshot: "match_day",
  scouting_coverage: "match_day",
  alliance_desk: "match_day",
  event_countdown: "match_day",
  event_readiness: "match_day",
  weather_venue: "match_day",
  pit_youtube: "match_day",
  alerts: "match_day",
  sync_status: "match_day",
  onboarding_checklist: "team",
  quick_actions: "team",
  team_chat: "team",
  announcements_ack: "team",
  team_todos: "team",
  subteam_upcoming: "team",
  calendar_today: "team",
  attendance: "team",
  duties: "team",
  outreach_hours: "team",
  team_profile: "team",
  sponsor_followups: "team",
  ai_usage: "team",
  robot_readiness: "build",
  batteries: "build",
  cad_resources: "build",
  coding_resources: "build",
  assembly_manual: "build",
  budget_parts: "build",
  my_day: "me",
  notifications: "me",
  hours_month: "me",
  learn_progress: "me",
  files_recent: "me",
  ask_ai: "me",
};

/** Case-insensitive match on the name, the description, or the group it sits in. */
export function widgetMatchesSearch(entry: WidgetCatalogEntry, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = `${entry.label} ${entry.description} ${WIDGET_GROUP_LABEL[WIDGET_GROUP[entry.type]]}`.toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/** Rows grouped for the sheet, in a fixed group order, empty groups dropped. */
export function groupWidgetRows<T extends { entry: WidgetCatalogEntry }>(
  rows: readonly T[],
  query = "",
): { group: WidgetGroup; label: string; rows: T[] }[] {
  const matching = rows.filter((row) => widgetMatchesSearch(row.entry, query));
  return WIDGET_GROUP_ORDER.map((group) => ({
    group,
    label: WIDGET_GROUP_LABEL[group],
    rows: matching.filter((row) => WIDGET_GROUP[row.entry.type] === group),
  })).filter((section) => section.rows.length > 0);
}

function layoutKey(layout: readonly DashboardWidgetLayout[]): string {
  return [...layout]
    .map((item) => `${item.i}|${item.type}|${item.x}|${item.y}|${item.w}|${item.h}|${isAlwaysShown(item) ? "always" : ""}`)
    .sort()
    .join(";");
}

/** Same cards in the same places at the same sizes. Array order does not matter. */
export function layoutsEqual(
  a: readonly DashboardWidgetLayout[] | null | undefined,
  b: readonly DashboardWidgetLayout[] | null | undefined,
): boolean {
  return layoutKey(a ?? []) === layoutKey(b ?? []);
}

/**
 * packDashboardLayout, keeping the array in its original order.
 *
 * The board's DOM follows the array, and packDashboardLayout returns cards in
 * reading order. Re-sorting mid-drag made React move the dragged card's node,
 * which can drop the pointer capture the drag depends on — and it shuffles
 * which card is "second" for anything counting cards. Positions come from the
 * pack; order stays put.
 */
export function packKeepingOrder(layout: DashboardWidgetLayout[]): DashboardWidgetLayout[] {
  const packed = new Map(packDashboardLayout(layout).map((item) => [item.i, item]));
  return layout.map((item) => packed.get(item.i) ?? item);
}

/**
 * Packs a board of any column count the way Home packs the saved one: each
 * card, in reading order, takes the first free spot from the top-left. That
 * closes gaps across as well as up. Array order is kept, like packKeepingOrder.
 */
export function packInColumns(layout: DashboardWidgetLayout[], cols: number): DashboardWidgetLayout[] {
  const columns = Math.max(1, Math.floor(cols) || 1);
  const ordered = [...layout].sort((a, b) => a.y - b.y || a.x - b.x || a.i.localeCompare(b.i));
  const placed: DashboardWidgetLayout[] = [];
  for (const item of ordered) {
    const w = Math.max(1, Math.min(columns, Math.floor(item.w)));
    const h = Math.max(1, Math.floor(item.h));
    placed.push({ ...item, ...findDashboardSlot(placed, w, h, columns), w, h });
  }
  const byId = new Map(placed.map((item) => [item.i, item]));
  return layout.map((item) => byId.get(item.i) ?? item);
}

/**
 * The cards edit mode puts on the board: what Home shows, plus anything added
 * in this edit session (so a card you just added is there to see even if it
 * has nothing in it yet). Cards Home leaves out are listed under the board
 * instead of taking up full-size places on it.
 *
 * Not re-packed here: the drag maths works in column bands with vertical
 * gravity, and packing under it made a dragged card snap back. The draft is
 * laid out like Home once, on the way in (layoutForEditing).
 */
export function editBoardLayout(
  layout: DashboardWidgetLayout[],
  hidden: ReadonlyMap<string, unknown>,
  keep: ReadonlySet<string> = new Set(),
): DashboardWidgetLayout[] {
  return layout.filter((item) => !hidden.has(item.i) || keep.has(item.i));
}

/**
 * The draft edit mode starts from: the cards Home shows, where Home shows
 * them, and the cards it is hiding moved below them. Home packs around hidden
 * cards; left in their saved spots they would be holes on the edit board —
 * a row with a gap where "My day" sits empty. Hidden cards come back at the
 * end of the board, which is also where the "Hidden right now" row lists them.
 */
export function layoutForEditing(
  layout: DashboardWidgetLayout[],
  hidden: ReadonlyMap<string, unknown>,
): DashboardWidgetLayout[] {
  const shown = packDashboardLayout(layout.filter((item) => !hidden.has(item.i)));
  const bottom = shown.reduce((max, item) => Math.max(max, item.y + item.h), 0);
  const tucked = packDashboardLayout(layout.filter((item) => hidden.has(item.i))).map((item) => ({
    ...item,
    y: item.y + bottom,
  }));
  const byId = new Map([...shown, ...tucked].map((item) => [item.i, item]));
  return layout.map((item) => byId.get(item.i) ?? item);
}

/** The same board with this card marked "Always show" (or not). */
export function setAlwaysShow(
  layout: DashboardWidgetLayout[],
  id: string,
  always: boolean,
): DashboardWidgetLayout[] {
  return layout.map((item) => {
    if (item.i !== id) return item;
    const rest: Record<string, unknown> = { ...(item.config ?? {}) };
    delete rest.alwaysShow;
    const config = always ? { ...rest, alwaysShow: true } : rest;
    return { ...item, config: Object.keys(config).length ? config : undefined };
  });
}

/**
 * "Snap & tidy". Reflows the cards on screen in reading order so every gap a
 * card can fill is filled — across as well as up — and says whether anything
 * on screen actually moved, so the toast never claims a move that did not
 * happen.
 *
 * The saved 12-column board is packed on every screen. A tablet shows it scaled
 * down, and packing the tablet view instead and scaling that back up changed card
 * widths on the desktop board (a 4-wide card came back 3 wide), so a rounding hole
 * that only exists on a tablet stays and tidy says "Nothing to tidy."
 */
export function tidyBoard(input: {
  layout: DashboardWidgetLayout[];
  /** Cards painted on the board right now (Home's hidden ones are not). */
  visibleIds: ReadonlySet<string>;
  /** The screen's column count. Tidy packs the saved board whatever it is. */
  cols?: number;
  /** The board as painted for a given saved layout. */
  displayFor: (layout: DashboardWidgetLayout[]) => DashboardWidgetLayout[];
}): { layout: DashboardWidgetLayout[]; moved: boolean } {
  const { layout, visibleIds, displayFor } = input;
  const before = displayFor(layout);
  // Always the saved 12-column board, never the scaled-down view written back: a tablet
  // view cannot be scaled back up without changing card widths on the desktop board.
  const packed = new Map(
    packDashboardLayout(layout.filter((item) => visibleIds.has(item.i))).map((item) => [item.i, item]),
  );
  const next = layout.map((item) => packed.get(item.i) ?? item);
  // Judged on screen: a saved-board change nobody can see is not "moved".
  const moved = !samePositions(before, displayFor(next));
  return moved ? { layout: next, moved } : { layout, moved: false };
}

/** Same positions for every card in `a` that is also in `b`. */
export function samePositions(a: readonly DashboardWidgetLayout[], b: readonly DashboardWidgetLayout[]): boolean {
  const byId = new Map(b.map((item) => [item.i, item]));
  return a.every((item) => {
    const other = byId.get(item.i);
    return other ? other.x === item.x && other.y === item.y && other.w === item.w && other.h === item.h : true;
  });
}

/** How many steps Undo remembers. A season of fiddling does not need more. */
export const EDIT_HISTORY_LIMIT = 50;

/**
 * The stack with `snapshot` on top. A snapshot equal to the current top is
 * dropped, so a drag that ends where it started does not cost an Undo press.
 */
export function pushHistory(
  stack: readonly DashboardWidgetLayout[][],
  snapshot: DashboardWidgetLayout[],
  limit = EDIT_HISTORY_LIMIT,
): DashboardWidgetLayout[][] {
  const top = stack[stack.length - 1];
  if (top && layoutsEqual(top, snapshot)) return [...stack];
  const next = [...stack, snapshot];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

/** The layout to go back to, and the stack without it. */
export function popHistory(stack: readonly DashboardWidgetLayout[][]): {
  layout: DashboardWidgetLayout[] | null;
  stack: DashboardWidgetLayout[][];
} {
  if (stack.length === 0) return { layout: null, stack: [] };
  return { layout: stack[stack.length - 1] ?? null, stack: stack.slice(0, -1) };
}

export type HiddenOnHomeReason = "empty" | "setup_done";

export const HIDDEN_ON_HOME_COPY: Record<HiddenOnHomeReason, string> = {
  empty: "Hidden until there's something to show",
  setup_done: "Hidden now that your team is set up",
};

/**
 * Cards that edit mode shows but the normal Home leaves out. Asks
 * homeViewLayout itself rather than restating its rules, so the label can
 * never disagree with what Home actually does.
 */
export function hiddenOnHome(
  layout: DashboardWidgetLayout[],
  input: {
    shell: "loading" | "no_org" | "setup" | "tba" | "ready";
    widgets?: Record<string, { status?: string } | undefined>;
    teamSetupCard?: boolean;
  },
): Map<string, HiddenOnHomeReason> {
  const shown = new Set(
    homeViewLayout(layout, { editing: false, shell: input.shell, widgets: input.widgets, teamSetupCard: input.teamSetupCard }).map(
      (item) => item.i,
    ),
  );
  // Cards no build of Home can show (the pit stream with media off) are not
  // "hidden right now" — nothing the member does would bring them back.
  const possible = new Set(
    homeViewLayout(layout, { editing: true, shell: input.shell }).map((item) => item.i),
  );
  const rows = input.widgets ?? {};
  const hidden = new Map<string, HiddenOnHomeReason>();
  for (const item of layout) {
    if (shown.has(item.i) || !possible.has(item.i)) continue;
    const status = (rows[item.i] ?? rows[item.type])?.status;
    hidden.set(item.i, status === "empty" ? "empty" : "setup_done");
  }
  return hidden;
}

/** "Match day", or "Match day 2" when that name is taken. */
export function suggestBoardName(existingNames: readonly string[], base = "Match day"): string {
  const taken = new Set(existingNames.map((name) => name.trim().toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; n < 100; n += 1) {
    const candidate = `${base} ${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return base;
}
