/**
 * Pure helpers for editing Home: the widget sheet's groups and search, the
 * draft's undo history, "are there unsaved changes", and which cards the
 * normal view hides. DOM-free so it runs under vitest in node.
 */

import {
  homeViewLayout,
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
    .map((item) => `${item.i}|${item.type}|${item.x}|${item.y}|${item.w}|${item.h}`)
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
  },
): Map<string, HiddenOnHomeReason> {
  const shown = new Set(
    homeViewLayout(layout, { editing: false, shell: input.shell, widgets: input.widgets }).map((item) => item.i),
  );
  const rows = input.widgets ?? {};
  const hidden = new Map<string, HiddenOnHomeReason>();
  for (const item of layout) {
    if (shown.has(item.i)) continue;
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
