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
};

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

/** Phone 4-col, tablet 8-col, laptop 12-col, pit TV larger tiles. */
export function dashboardGridForWidth(width: number): DashboardGrid {
  if (width < 640) return { cols: 4, rowHeight: 86, margin: [10, 10], label: "phone" };
  if (width < 1024) return { cols: 8, rowHeight: 72, margin: [12, 12], label: "tablet" };
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
 * View-mode Home: live widgets plus next-match. Empty/setup cards stay off the
 * board until Edit Home — never a wall of DEMO-looking placeholders.
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
  const widgets = input.widgets ?? {};
  const visible = layout.filter((item) => {
    if (SETUP_ONLY_WIDGETS.has(item.type)) return !ready;
    if (item.type === "next_match") return true;
    return widgets[item.type]?.status === "live";
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
    description: "Open shared todos, yours first — no invented demo items",
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
