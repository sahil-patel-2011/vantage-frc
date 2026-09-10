export const DASHBOARD_WIDGET_TYPES = [
  "onboarding_checklist",
  "next_match",
  "recent_result",
  "competition_snapshot",
  "scouting_coverage",
  "prediction_summary",
  "sync_status",
  "pit_youtube",
  "ai_usage",
  "quick_actions",
  "notifications",
  "robot_readiness",
  "alerts",
  "team_todos",
  "subteam_upcoming",
  "my_day",
  "learn_progress",
  "files_recent",
  "team_chat",
  "duties",
  "budget_parts",
  "attendance",
  "outreach_hours",
  "announcements_ack",
  "ask_ai",
  "event_countdown",
  "hours_month",
  "calendar_today",
  "cad_resources",
  "coding_resources",
  "team_profile",
  "alliance_desk",
  "match_schedule",
  "batteries",
  "assembly_manual",
  "sponsor_followups",
  "event_readiness",
  "weather_venue",
] as const;

export type DashboardWidgetType = (typeof DASHBOARD_WIDGET_TYPES)[number];

export type OrgRole = "owner" | "admin" | "scout" | "viewer";

export type DashboardWidgetLayout = {
  i: string;
  type: DashboardWidgetType;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  config?: Record<string, unknown>;
};

export type HomeAudienceKind = "student" | "mentor";

export type WidgetCatalogEntry = {
  type: DashboardWidgetType;
  label: string;
  description: string;
  defaultW: number;
  defaultH: number;
  minW: number;
  minH: number;
  /** Roles allowed to add/view this widget. Empty = all members. */
  roles?: OrgRole[];
  /** Apple-style sizes this widget may be resized to. Default S/M/L. */
  sizes?: WidgetSizeKey[];
  /** Who the widget is for. Omit = both. */
  audience?: HomeAudienceKind[];
  /** Plain-language condition under which the widget hides in view mode. */
  emptyWhen?: string;
  /** In-app help slug (docs/FEATURE_MAP + /help/<slug>). */
  helpArticle?: string;
};

/** Widgets that stay on Home even with no live row — they are the empty-state CTA. */
export const HOME_ALWAYS_VISIBLE: ReadonlySet<DashboardWidgetType> = new Set([
  "next_match",
  "ask_ai",
]);

export function widgetRegistryMeta(entry: WidgetCatalogEntry): {
  sizes: WidgetSizeKey[];
  audience: HomeAudienceKind[];
  emptyWhen: string;
  helpArticle: string;
} {
  return {
    sizes: entry.sizes ?? ["s", "m", "l"],
    audience: entry.audience ?? ["student", "mentor"],
    emptyWhen: entry.emptyWhen ?? "No real data yet",
    helpArticle: entry.helpArticle ?? "edit-home",
  };
}

export const DASHBOARD_COLUMNS = 12;

/** iOS-style widget sizes. Canonical cells are for the 12-column laptop grid. */
export const WIDGET_SIZE_KEYS = ["s", "m", "l", "xl"] as const;
export type WidgetSizeKey = (typeof WIDGET_SIZE_KEYS)[number];

export const WIDGET_SIZE_LABEL: Record<WidgetSizeKey, string> = {
  s: "S",
  m: "M",
  l: "L",
  xl: "XL",
};

/** Small / medium / large / extra-large on the saved 12-column board. */
export const WIDGET_SIZE_CELLS_12: Record<WidgetSizeKey, { w: number; h: number }> = {
  s: { w: 3, h: 2 },
  m: { w: 4, h: 3 },
  l: { w: 6, h: 4 },
  xl: { w: 12, h: 4 },
};

export type DashboardGrid = {
  cols: number;
  rowHeight: number;
  margin: [number, number];
  label: "phone" | "tablet" | "laptop" | "tv";
};

/** Phone 1/2-col, tablet 4-col, laptop/TV 12-col saved board. */
export function dashboardGridForWidth(width: number): DashboardGrid {
  if (width < 400) return { cols: 1, rowHeight: 96, margin: [8, 10], label: "phone" };
  if (width < 640) return { cols: 2, rowHeight: 90, margin: [10, 10], label: "phone" };
  if (width < 1024) return { cols: 4, rowHeight: 80, margin: [12, 12], label: "tablet" };
  if (width >= 1600) return { cols: 12, rowHeight: 92, margin: [16, 16], label: "tv" };
  return { cols: 12, rowHeight: 72, margin: [12, 12], label: "laptop" };
}

export function scaleLayoutToCols(
  layout: DashboardWidgetLayout[],
  fromCols: number,
  toCols: number,
): DashboardWidgetLayout[] {
  if (fromCols === toCols || fromCols < 1 || toCols < 1) {
    return layout.map((item) => ({ ...item }));
  }
  const factor = toCols / fromCols;
  return layout.map((item) => {
    const w = Math.max(1, Math.min(toCols, Math.round(item.w * factor)));
    const x = Math.max(0, Math.min(toCols - w, Math.round(item.x * factor)));
    return { ...item, x, w, minW: 1 };
  });
}

export function applyWidgetSize(
  item: DashboardWidgetLayout,
  size: WidgetSizeKey,
  entry?: WidgetCatalogEntry,
): DashboardWidgetLayout {
  const cells = WIDGET_SIZE_CELLS_12[size];
  const minW = entry?.minW ?? item.minW ?? 1;
  const minH = entry?.minH ?? item.minH ?? 1;
  const w = Math.min(DASHBOARD_COLUMNS, Math.max(minW, cells.w));
  const h = Math.max(minH, cells.h);
  return { ...item, w, h, minW, minH };
}

export function inferWidgetSize(item: Pick<DashboardWidgetLayout, "w" | "h">): WidgetSizeKey {
  let best: WidgetSizeKey = "m";
  let bestDist = Number.POSITIVE_INFINITY;
  for (const key of WIDGET_SIZE_KEYS) {
    const cells = WIDGET_SIZE_CELLS_12[key];
    const dist = Math.abs(item.w - cells.w) + Math.abs(item.h - cells.h);
    if (dist < bestDist) {
      best = key;
      bestDist = dist;
    }
  }
  return best;
}

type DashboardRect = Pick<DashboardWidgetLayout, "x" | "y" | "w" | "h">;

export function dashboardRectsOverlap(a: DashboardRect, b: DashboardRect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Finds the first top-to-bottom grid slot that does not overlap an existing widget. */
export function findDashboardSlot(
  layout: DashboardRect[],
  width: number,
  height: number,
  columns = DASHBOARD_COLUMNS,
): { x: number; y: number } {
  const w = Math.max(1, Math.min(columns, Math.floor(width)));
  const h = Math.max(1, Math.floor(height));
  const searchRows = layout.reduce((max, item) => Math.max(max, item.y + item.h), 0) + h + 1;
  for (let y = 0; y <= searchRows; y += 1) {
    for (let x = 0; x <= columns - w; x += 1) {
      const candidate = { x, y, w, h };
      if (!layout.some((item) => dashboardRectsOverlap(candidate, item))) return { x, y };
    }
  }
  return { x: 0, y: searchRows };
}

/** Packs widgets upward and leftward while preserving their relative visual order. */
export function packDashboardLayout(layout: DashboardWidgetLayout[]): DashboardWidgetLayout[] {
  const placed: DashboardWidgetLayout[] = [];
  const ordered = [...layout].sort((a, b) => a.y - b.y || a.x - b.x);
  for (const item of ordered) {
    const w = Math.max(1, Math.min(DASHBOARD_COLUMNS, Math.floor(item.w)));
    const h = Math.max(1, Math.floor(item.h));
    const position = findDashboardSlot(placed, w, h);
    placed.push({ ...item, ...position, w, h });
  }
  return placed;
}

const SETUP_ONLY_WIDGETS = new Set<DashboardWidgetType>(["onboarding_checklist", "quick_actions"]);

/**
 * View-mode Home keeps every user-placed widget, including honest empty
 * states with a destination CTA. Setup-only cards hide once the workspace
 * is ready. Next match stays a full-width hero.
 */
export function homeViewLayout(
  layout: DashboardWidgetLayout[],
  input: {
    editing: boolean;
    shell: "loading" | "no_org" | "setup" | "tba" | "ready";
    widgets?: Record<string, { status?: string } | undefined>;
  },
): DashboardWidgetLayout[] {
  if (input.editing) return layout.map((item) => ({ ...item }));
  const ready = input.shell === "ready";
  const snapshot = input.widgets;
  const visible = layout.filter((item) => {
    if (ready && SETUP_ONLY_WIDGETS.has(item.type)) return false;
    if (HOME_ALWAYS_VISIBLE.has(item.type)) return true;
    if (!snapshot) return true;
    const status = snapshot[item.type]?.status;
    if (status === "empty" || status === "setup_required") return false;
    return true;
  });
  return packDashboardLayout(
    visible.map((item) =>
      item.type === "next_match" ? { ...item, x: 0, w: DASHBOARD_COLUMNS } : item,
    ),
  );
}

export const WIDGET_CATALOG: WidgetCatalogEntry[] = [
  {
    type: "onboarding_checklist",
    label: "Setup checklist",
    description: "First-run steps: workspace, event, TBA, scouting, and AI",
    defaultW: 12,
    defaultH: 4,
    minW: 6,
    minH: 3,
  },
  {
    type: "next_match",
    label: "Next match",
    description: "Countdown, bumper color, and alliances for your next match",
    defaultW: 12,
    defaultH: 4,
    minW: 3,
    minH: 3,
  },
  {
    type: "robot_readiness",
    label: "Robot readiness",
    description: "Maintenance due, batteries, and open failure notes",
    defaultW: 6,
    defaultH: 4,
    minW: 3,
    minH: 3,
  },
  {
    type: "recent_result",
    label: "Recent result",
    description: "Latest completed match score for your team",
    defaultW: 4,
    defaultH: 3,
    minW: 3,
    minH: 2,
  },
  {
    type: "prediction_summary",
    label: "Prediction",
    description: "Latest stored win-probability for the active event",
    defaultW: 4,
    defaultH: 3,
    minW: 3,
    minH: 2,
  },
  {
    type: "alerts",
    label: "Alerts",
    description: "Live ops alerts and open scouting disagreements",
    defaultW: 4,
    defaultH: 3,
    minW: 3,
    minH: 2,
  },
  {
    type: "team_todos",
    label: "Team todos",
    description: "Open shared todos, yours first",
    defaultW: 4,
    defaultH: 3,
    minW: 3,
    minH: 2,
  },
  {
    type: "subteam_upcoming",
    label: "What's next (subteam)",
    description: "Upcoming practices and deadlines for your subteams",
    defaultW: 4,
    defaultH: 3,
    minW: 3,
    minH: 2,
  },
  {
    type: "scouting_coverage",
    label: "Scouting coverage",
    description: "Assignments, reports, and open disagreements",
    defaultW: 4,
    defaultH: 3,
    minW: 3,
    minH: 2,
  },
  {
    type: "competition_snapshot",
    label: "Competition snapshot",
    description: "Rank, record, and EPA from synced reference tables",
    defaultW: 6,
    defaultH: 3,
    minW: 3,
    minH: 2,
  },
  {
    type: "sync_status",
    label: "Sync status",
    description: "TBA / Statbotics health and last successful sync",
    defaultW: 4,
    defaultH: 3,
    minW: 3,
    minH: 2,
  },
  {
    type: "pit_youtube",
    label: "Pit stream",
    description: "Organization YouTube pit embed",
    defaultW: 6,
    defaultH: 4,
    minW: 4,
    minH: 3,
  },
  {
    type: "notifications",
    label: "Notifications",
    description: "Unread notifications for the signed-in user",
    defaultW: 4,
    defaultH: 3,
    minW: 3,
    minH: 2,
  },
  {
    type: "quick_actions",
    label: "Quick actions",
    description: "Shortcuts into scout, strategy, messages, and code",
    defaultW: 4,
    defaultH: 3,
    minW: 3,
    minH: 2,
  },
  {
    type: "ai_usage",
    label: "AI usage",
    description: "Credits and allowance (owner/admin only)",
    defaultW: 4,
    defaultH: 3,
    minW: 3,
    minH: 2,
    roles: ["owner", "admin"],
  },
  {
    type: "my_day",
    label: "My day",
    description: "Your next match, leave time, and what to do now",
    defaultW: 4,
    defaultH: 3,
    minW: 3,
    minH: 2,
    audience: ["student"],
    emptyWhen: "No event day schedule yet",
    helpArticle: "edit-home",
  },
  {
    type: "learn_progress",
    label: "Learn",
    description: "CAD and programming track progress",
    defaultW: 4,
    defaultH: 3,
    minW: 3,
    minH: 2,
    audience: ["student"],
    emptyWhen: "No learning track started",
    helpArticle: "edit-home",
  },
  {
    type: "files_recent",
    label: "Recent files",
    description: "Files you opened or that were shared with you",
    defaultW: 4,
    defaultH: 3,
    minW: 3,
    minH: 2,
    emptyWhen: "No files yet",
    helpArticle: "edit-home",
  },
  {
    type: "team_chat",
    label: "Team chat",
    description: "Unread team messages",
    defaultW: 4,
    defaultH: 3,
    minW: 3,
    minH: 2,
    emptyWhen: "No unread chats",
    helpArticle: "edit-home",
  },
  {
    type: "duties",
    label: "Duties",
    description: "Needs assignment tonight",
    defaultW: 4,
    defaultH: 3,
    minW: 3,
    minH: 2,
    audience: ["mentor"],
    emptyWhen: "Nothing needs assignment",
    helpArticle: "edit-home",
  },
  {
    type: "budget_parts",
    label: "Budget & parts",
    description: "Budget remaining and part requests waiting",
    defaultW: 4,
    defaultH: 3,
    minW: 3,
    minH: 2,
    roles: ["owner", "admin"],
    audience: ["mentor"],
    emptyWhen: "No budget row or open requests",
    helpArticle: "edit-home",
  },
  {
    type: "attendance",
    label: "Attendance tonight",
    description: "Who is expected at the next session",
    defaultW: 4,
    defaultH: 3,
    minW: 3,
    minH: 2,
    audience: ["mentor"],
    emptyWhen: "No session scheduled",
    helpArticle: "edit-home",
  },
  {
    type: "outreach_hours",
    label: "Outreach hours",
    description: "Hours logged this month",
    defaultW: 4,
    defaultH: 3,
    minW: 3,
    minH: 2,
    emptyWhen: "No outreach logged this month",
    helpArticle: "edit-home",
  },
  {
    type: "announcements_ack",
    label: "Announcements",
    description: "Team notes that still need an acknowledgement",
    defaultW: 4,
    defaultH: 3,
    minW: 3,
    minH: 2,
    emptyWhen: "Nothing waiting on you",
    helpArticle: "edit-home",
  },
  {
    type: "ask_ai",
    label: "Ask AI",
    description: "Ask a question — opens chat with your team's facts",
    defaultW: 6,
    defaultH: 2,
    minW: 3,
    minH: 2,
    emptyWhen: "Always available",
    helpArticle: "edit-home",
  },
  {
    type: "event_countdown",
    label: "Next event",
    description: "Countdown to the next event on the calendar",
    defaultW: 4,
    defaultH: 3,
    minW: 3,
    minH: 2,
    emptyWhen: "No upcoming event",
    helpArticle: "edit-home",
  },
  {
    type: "hours_month",
    label: "Hours this month",
    description: "Your logged shop hours",
    defaultW: 3,
    defaultH: 2,
    minW: 3,
    minH: 2,
    sizes: ["s", "m"],
    emptyWhen: "No hours logged this month",
    helpArticle: "edit-home",
  },
  {
    type: "calendar_today",
    label: "Today",
    description: "Today and this week's calendar",
    defaultW: 4,
    defaultH: 3,
    minW: 3,
    minH: 2,
    emptyWhen: "Nothing on the calendar",
    helpArticle: "edit-home",
  },
  {
    type: "cad_resources",
    label: "CAD resources",
    description: "Vault recents and Onshape links",
    defaultW: 4,
    defaultH: 3,
    minW: 3,
    minH: 2,
    audience: ["student"],
    emptyWhen: "No CAD files or links yet",
    helpArticle: "edit-home",
  },
  {
    type: "coding_resources",
    label: "Coding resources",
    description: "Bound repo, deploy log, Bugbot findings",
    defaultW: 4,
    defaultH: 3,
    minW: 3,
    minH: 2,
    emptyWhen: "No repo bound",
    helpArticle: "edit-home",
  },
  {
    type: "team_profile",
    label: "Team profile",
    description: "What TBA and Statbotics have on record for this team",
    defaultW: 4,
    defaultH: 3,
    minW: 3,
    minH: 2,
    emptyWhen: "Team profile not built yet",
    helpArticle: "edit-home",
  },
  {
    type: "alliance_desk",
    label: "Alliance desk",
    description: "Alliance selection status at this event",
    defaultW: 4,
    defaultH: 3,
    minW: 3,
    minH: 2,
    emptyWhen: "Not in alliance selection",
    helpArticle: "edit-home",
  },
  {
    type: "match_schedule",
    label: "Match schedule",
    description: "Upcoming matches at the active event",
    defaultW: 6,
    defaultH: 4,
    minW: 3,
    minH: 2,
    emptyWhen: "No schedule synced",
    helpArticle: "edit-home",
  },
  {
    type: "batteries",
    label: "Batteries",
    description: "Battery cycle and charge state",
    defaultW: 4,
    defaultH: 3,
    minW: 3,
    minH: 2,
    emptyWhen: "No batteries logged",
    helpArticle: "edit-home",
  },
  {
    type: "assembly_manual",
    label: "Assembly manual",
    description: "Latest build-book runs",
    defaultW: 4,
    defaultH: 3,
    minW: 3,
    minH: 2,
    emptyWhen: "No assembly manual yet",
    helpArticle: "edit-home",
  },
  {
    type: "sponsor_followups",
    label: "Sponsor follow-ups",
    description: "Partners waiting on a reply",
    defaultW: 4,
    defaultH: 3,
    minW: 3,
    minH: 2,
    roles: ["owner", "admin"],
    audience: ["mentor"],
    emptyWhen: "No open follow-ups, or this team does not use sponsors",
    helpArticle: "edit-home",
  },
  {
    type: "event_readiness",
    label: "Event readiness",
    description: "Travel, packing, and inspection still open",
    defaultW: 4,
    defaultH: 3,
    minW: 3,
    minH: 2,
    emptyWhen: "No event on the calendar",
    helpArticle: "edit-home",
  },
  {
    type: "weather_venue",
    label: "Venue weather",
    description: "Public forecast on event day, only when the event has a location",
    defaultW: 3,
    defaultH: 2,
    minW: 3,
    minH: 2,
    sizes: ["s", "m"],
    emptyWhen: "No event with a location",
    helpArticle: "edit-home",
  },
];

export const DEFAULT_DASHBOARD_LAYOUT: DashboardWidgetLayout[] = [
  { i: "w-next_match", type: "next_match", x: 0, y: 0, w: 12, h: 4, minW: 3, minH: 3 },
  { i: "w-competition_snapshot", type: "competition_snapshot", x: 0, y: 4, w: 6, h: 3, minW: 3, minH: 2 },
  { i: "w-robot_readiness", type: "robot_readiness", x: 6, y: 4, w: 6, h: 3, minW: 3, minH: 2 },
  { i: "w-alerts", type: "alerts", x: 0, y: 7, w: 4, h: 3, minW: 3, minH: 2 },
  { i: "w-recent_result", type: "recent_result", x: 4, y: 7, w: 4, h: 3, minW: 3, minH: 2 },
  { i: "w-scouting_coverage", type: "scouting_coverage", x: 8, y: 7, w: 4, h: 3, minW: 3, minH: 2 },
];

export type DashboardPrimaryFocus = "competition" | "build" | "business" | "leadership";

const FOCUS_DASHBOARD_LAYOUTS: Record<DashboardPrimaryFocus, DashboardWidgetLayout[]> = {
  competition: DEFAULT_DASHBOARD_LAYOUT,
  build: [
    { i: "w-robot_readiness", type: "robot_readiness", x: 0, y: 0, w: 6, h: 4, minW: 3, minH: 3 },
    { i: "w-subteam_upcoming", type: "subteam_upcoming", x: 6, y: 0, w: 6, h: 4, minW: 3, minH: 2 },
    { i: "w-alerts", type: "alerts", x: 0, y: 4, w: 4, h: 3, minW: 3, minH: 2 },
    { i: "w-sync_status", type: "sync_status", x: 4, y: 4, w: 4, h: 3, minW: 3, minH: 2 },
    { i: "w-quick_actions", type: "quick_actions", x: 8, y: 4, w: 4, h: 3, minW: 3, minH: 2 },
  ],
  business: [
    { i: "w-notifications", type: "notifications", x: 0, y: 0, w: 6, h: 3, minW: 3, minH: 2 },
    { i: "w-alerts", type: "alerts", x: 6, y: 0, w: 6, h: 3, minW: 3, minH: 2 },
    { i: "w-competition_snapshot", type: "competition_snapshot", x: 0, y: 3, w: 6, h: 3, minW: 3, minH: 2 },
    { i: "w-quick_actions", type: "quick_actions", x: 6, y: 3, w: 6, h: 3, minW: 3, minH: 2 },
  ],
  leadership: [
    { i: "w-robot_readiness", type: "robot_readiness", x: 0, y: 0, w: 6, h: 4, minW: 3, minH: 3 },
    { i: "w-alerts", type: "alerts", x: 6, y: 0, w: 6, h: 4, minW: 3, minH: 2 },
    { i: "w-notifications", type: "notifications", x: 0, y: 4, w: 4, h: 3, minW: 3, minH: 2 },
    { i: "w-quick_actions", type: "quick_actions", x: 4, y: 4, w: 4, h: 3, minW: 3, minH: 2 },
    { i: "w-ai_usage", type: "ai_usage", x: 8, y: 4, w: 4, h: 3, minW: 3, minH: 2 },
  ],
};

export function defaultDashboardLayoutForFocus(focus: string | null | undefined): DashboardWidgetLayout[] {
  const key = (focus && focus in FOCUS_DASHBOARD_LAYOUTS ? focus : "competition") as DashboardPrimaryFocus;
  return FOCUS_DASHBOARD_LAYOUTS[key].map((item) => ({ ...item }));
}

const STUDENT_HOME_LAYOUT: DashboardWidgetLayout[] = [
  { i: "w-next_match", type: "next_match", x: 0, y: 0, w: 12, h: 4, minW: 3, minH: 3 },
  { i: "w-my_day", type: "my_day", x: 0, y: 4, w: 4, h: 3, minW: 3, minH: 2 },
  { i: "w-learn_progress", type: "learn_progress", x: 4, y: 4, w: 4, h: 3, minW: 3, minH: 2 },
  { i: "w-team_todos", type: "team_todos", x: 8, y: 4, w: 4, h: 3, minW: 3, minH: 2 },
  { i: "w-files_recent", type: "files_recent", x: 0, y: 7, w: 4, h: 3, minW: 3, minH: 2 },
  { i: "w-team_chat", type: "team_chat", x: 4, y: 7, w: 4, h: 3, minW: 3, minH: 2 },
  { i: "w-ask_ai", type: "ask_ai", x: 8, y: 7, w: 4, h: 3, minW: 3, minH: 2 },
];

const MENTOR_HOME_LAYOUT: DashboardWidgetLayout[] = [
  { i: "w-next_match", type: "next_match", x: 0, y: 0, w: 12, h: 4, minW: 3, minH: 3 },
  { i: "w-duties", type: "duties", x: 0, y: 4, w: 4, h: 3, minW: 3, minH: 2 },
  { i: "w-budget_parts", type: "budget_parts", x: 4, y: 4, w: 4, h: 3, minW: 3, minH: 2 },
  { i: "w-attendance", type: "attendance", x: 8, y: 4, w: 4, h: 3, minW: 3, minH: 2 },
  { i: "w-outreach_hours", type: "outreach_hours", x: 0, y: 7, w: 4, h: 3, minW: 3, minH: 2 },
  { i: "w-announcements_ack", type: "announcements_ack", x: 4, y: 7, w: 4, h: 3, minW: 3, minH: 2 },
];

/** Personal Home for a new student vs a mentor — not the competition-focus board. */
export function defaultDashboardLayoutForAudience(
  audience: HomeAudienceKind | null | undefined,
): DashboardWidgetLayout[] {
  const layout = audience === "mentor" ? MENTOR_HOME_LAYOUT : STUDENT_HOME_LAYOUT;
  return layout.map((item) => ({ ...item }));
}

export const SECONDARY_WIDGET_TYPES: DashboardWidgetType[] = [
  "competition_snapshot",
  "scouting_coverage",
  "sync_status",
  "recent_result",
  "pit_youtube",
  "notifications",
  "team_todos",
  "prediction_summary",
  "subteam_upcoming",
];

export function isDashboardWidgetType(value: unknown): value is DashboardWidgetType {
  return typeof value === "string" && (DASHBOARD_WIDGET_TYPES as readonly string[]).includes(value);
}

export function catalogEntry(type: DashboardWidgetType) {
  return WIDGET_CATALOG.find((entry) => entry.type === type);
}

export function canAccessWidget(type: DashboardWidgetType, role: string | null | undefined) {
  const entry = catalogEntry(type);
  if (!entry?.roles?.length) return true;
  if (!role) return false;
  return entry.roles.includes(role as OrgRole);
}

export function filterLayoutForRole(
  layout: DashboardWidgetLayout[],
  role: string | null | undefined,
): DashboardWidgetLayout[] {
  return layout.filter((item) => canAccessWidget(item.type, role));
}

export function validateDashboardLayout(
  layout: unknown,
  role: string | null | undefined,
): { ok: true; layout: DashboardWidgetLayout[] } | { ok: false; error: string } {
  if (!Array.isArray(layout)) return { ok: false, error: "Layout must be an array" };
  if (layout.length > 24) return { ok: false, error: "Too many widgets (max 24)" };

  const seen = new Set<string>();
  const normalized: DashboardWidgetLayout[] = [];

  for (const raw of layout) {
    if (!raw || typeof raw !== "object") return { ok: false, error: "Invalid widget entry" };
    const item = raw as Record<string, unknown>;
    if (!isDashboardWidgetType(item.type)) return { ok: false, error: `Unknown widget type: ${String(item.type)}` };
    if (!canAccessWidget(item.type, role)) {
      return { ok: false, error: `Widget ${item.type} requires elevated role` };
    }
    const id = String(item.i ?? "").trim() || `w-${item.type}-${normalized.length}`;
    if (seen.has(id)) return { ok: false, error: `Duplicate widget id: ${id}` };
    seen.add(id);

    const entry = catalogEntry(item.type)!;
    const x = Number(item.x);
    const y = Number(item.y);
    const rawW = Number(item.w);
    const rawH = Number(item.h);
    if (![x, y, rawW, rawH].every((n) => Number.isFinite(n) && n >= 0)) {
      return { ok: false, error: "Widget grid coordinates must be numbers" };
    }
    const w = Math.min(DASHBOARD_COLUMNS, Math.max(entry.minW, Math.floor(rawW)));
    const h = Math.min(12, Math.max(entry.minH, Math.floor(rawH)));
    if (w < entry.minW || h < entry.minH) {
      return { ok: false, error: `Invalid size for ${item.type}` };
    }

    normalized.push({
      i: id.slice(0, 64),
      type: item.type,
      x: Math.min(DASHBOARD_COLUMNS - w, Math.floor(x)),
      y: Math.floor(y),
      w,
      h,
      minW: entry.minW,
      minH: entry.minH,
      config:
        item.config && typeof item.config === "object" && !Array.isArray(item.config)
          ? (item.config as Record<string, unknown>)
          : undefined,
    });
  }

  return { ok: true, layout: normalized };
}

export function canWriteOrgDashboard(role: string | null | undefined) {
  return role === "owner" || role === "admin";
}
