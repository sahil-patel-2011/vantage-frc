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
    description: "Countdown and alliances for your next scheduled match",
    defaultW: 6,
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
  { i: "w-onboarding_checklist", type: "onboarding_checklist", x: 0, y: 0, w: 12, h: 4, minW: 6, minH: 3 },
  { i: "w-next_match", type: "next_match", x: 0, y: 4, w: 6, h: 4, minW: 3, minH: 3 },
  { i: "w-robot_readiness", type: "robot_readiness", x: 6, y: 4, w: 6, h: 4, minW: 3, minH: 3 },
  { i: "w-prediction_summary", type: "prediction_summary", x: 0, y: 8, w: 4, h: 3, minW: 3, minH: 2 },
  { i: "w-alerts", type: "alerts", x: 4, y: 8, w: 4, h: 3, minW: 3, minH: 2 },
  { i: "w-quick_actions", type: "quick_actions", x: 8, y: 8, w: 4, h: 3, minW: 3, minH: 2 },
];

export const SECONDARY_WIDGET_TYPES: DashboardWidgetType[] = [
  "competition_snapshot",
  "scouting_coverage",
  "sync_status",
  "recent_result",
  "pit_youtube",
  "notifications",
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
    const w = Math.min(12, Math.max(entry.minW, Math.floor(rawW)));
    const h = Math.min(12, Math.max(entry.minH, Math.floor(rawH)));
    if (w < entry.minW || h < entry.minH) {
      return { ok: false, error: `Invalid size for ${item.type}` };
    }

    normalized.push({
      i: id.slice(0, 64),
      type: item.type,
      x: Math.floor(x),
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
