/**
 * Pure helpers for editing Home: the widget sheet's groups and search, the
 * draft's undo history, "are there unsaved changes", and which cards the
 * normal view hides. DOM-free so it runs under vitest in node.
 */

import {
  DASHBOARD_COLUMNS,
  fillRowEnds,
  findDashboardSlot,
  homeViewLayout,
  isAlwaysShown,
  packDashboardLayout,
  sizeForHome,
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
/**
 * Words people search for that a card's own label does not contain: "pit" finds Batteries and
 * Robot readiness, "money" finds Budget.
 */
const WIDGET_KEYWORDS: Partial<Record<DashboardWidgetType, string>> = {
  next_match: "match schedule queue bumper alliance partners",
  recent_result: "match score result",
  competition_snapshot: "event rank ranking record",
  scouting_coverage: "scout scouting coverage",
  prediction_summary: "odds win chance strategy",
  pit_youtube: "pit stream video livestream",
  robot_readiness: "pit robot inspection ready",
  alerts: "pit warnings",
  batteries: "pit battery charge",
  event_readiness: "pit packing travel event",
  budget_parts: "money budget spend parts orders",
  sponsor_followups: "money sponsors fundraising",
  hours_month: "attendance time shop",
  attendance: "hours roll call",
  outreach_hours: "community impact volunteer",
  team_chat: "messages",
  ask_ai: "ai chat assistant",
  cad_resources: "onshape fusion design",
  coding_resources: "code programming github",
  match_schedule: "matches schedule qualification",
  alliance_desk: "picks pick list selection",
  weather_venue: "forecast rain",
};

export function widgetMatchesSearch(entry: WidgetCatalogEntry, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack =
    `${entry.label} ${entry.description} ${WIDGET_GROUP_LABEL[WIDGET_GROUP[entry.type]]} ${WIDGET_KEYWORDS[entry.type] ?? ""}`.toLowerCase();
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
 * Packed exactly the way Home packs (first free spot, in reading order), so the
 * edit board never shows a hole that Home would close on its own. A drag is a
 * change of order (lib/dashboard/board-order), which this packing keeps.
 */
export function editBoardLayout(
  layout: DashboardWidgetLayout[],
  hidden: ReadonlyMap<string, unknown>,
  keep: ReadonlySet<string> = new Set(),
  widgets?: Record<string, { status?: string } | undefined>,
): DashboardWidgetLayout[] {
  // Array order kept (positions from the pack): React moving the dragged card's node mid-drag
  // drops the pointer capture the drag runs on.
  // The same narrow-strip fill Home applies, so the editor shows the widths Home will show.
  return fillRowEnds(
    packKeepingOrder(sizeForHome(layout.filter((item) => !hidden.has(item.i) || keep.has(item.i)), widgets)),
  );
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
  // Packed, then any hole no card fits is closed by the card beside or above it growing into
  // it: tidy used to leave the hole and say "No card fits the gap", which was homework.
  const packed = new Map(
    closeInteriorGaps(packDashboardLayout(layout.filter((item) => visibleIds.has(item.i))), DASHBOARD_COLUMNS).map(
      (item) => [item.i, item],
    ),
  );
  const next = layout.map((item) => packed.get(item.i) ?? item);
  // Judged on screen: a saved-board change nobody can see is not "moved".
  const moved = !samePositions(before, displayFor(next));
  return moved ? { layout: next, moved } : { layout, moved: false };
}

/**
 * Grows cards into the holes packing could not fill: a card with empty columns to its right
 * widens into them, then a card with empty rows under it grows down. Only holes above the last
 * row count; the space after the last cards stays free for the next card.
 */
export function closeInteriorGaps(layout: DashboardWidgetLayout[], cols: number): DashboardWidgetLayout[] {
  if (layout.length === 0) return layout;
  const out = layout.map((item) => ({ ...item }));
  const lastStart = Math.max(...out.map((item) => item.y));
  const free = (x: number, y: number, h: number, self: DashboardWidgetLayout) =>
    out.every((other) => other === self || !(x >= other.x && x < other.x + other.w && y < other.y + other.h && other.y < y + h));
  const ordered = [...out].sort((a, b) => a.y - b.y || a.x - b.x);
  for (const item of ordered) {
    if (item.y + item.h > lastStart) continue;
    while (item.x + item.w < cols && free(item.x + item.w, item.y, item.h, item)) item.w += 1;
  }
  for (const item of ordered) {
    if (item.y + item.h > lastStart) continue;
    const rowFree = (row: number) =>
      out.every((other) => other === item || !(row >= other.y && row < other.y + other.h && other.x < item.x + item.w && item.x < other.x + other.w));
    while (item.y + item.h < lastStart && rowFree(item.y + item.h)) item.h += 1;
  }
  return out;
}

/**
 * True when the painted board has an empty cell above its last row: a gap tidy could not
 * fill because every card after it is wider than the gap.
 */
export function boardHasGap(display: readonly DashboardWidgetLayout[], cols: number): boolean {
  if (display.length === 0 || cols <= 0) return false;
  // An empty cell with a card starting below it; space after the last cards is not a gap.
  const lastStart = Math.max(...display.map((item) => item.y));
  for (let row = 0; row < lastStart; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const covered = display.some(
        (item) => col >= item.x && col < item.x + item.w && row >= item.y && row < item.y + item.h,
      );
      if (!covered) return true;
    }
  }
  return false;
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

export type HiddenOnHomeReason = "empty" | "setup_done" | "setup_top";

export const HIDDEN_ON_HOME_COPY: Record<HiddenOnHomeReason, string> = {
  empty: "Hidden until there's something to show",
  setup_done: "Hidden now that your team is set up",
  // The owner's setup steps are the card at the top of Home while setup is unfinished.
  setup_top: "Shown at the top while setup is unfinished",
};

/** The library's word for a card on the board that Home is not showing right now. */
export const HIDDEN_ON_HOME_SHORT: Record<HiddenOnHomeReason, string> = {
  empty: "Hidden (empty)",
  setup_done: "Hidden (set up)",
  setup_top: "Shown during setup",
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
    const setupCard = item.type === "onboarding_checklist" || item.type === "quick_actions";
    // While the owner's setup steps are the hero at the top, the setup card is not "done":
    // it is hidden because the same steps are already on screen.
    hidden.set(item.i, setupCard && input.teamSetupCard ? "setup_top" : status === "empty" ? "empty" : "setup_done");
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
