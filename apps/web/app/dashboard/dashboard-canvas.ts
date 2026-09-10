"use client";

import { useEffect, useState } from "react";
import {
  dashboardGridForWidth,
  type DashboardWidgetType,
  type OrgRole,
  type WidgetCatalogEntry,
} from "../../lib/dashboard/catalog";
import type { NudgeDirection } from "../../lib/dashboard/grid-drag";
import type { IconName } from "../../components/icon";

export const CONTEXT_REFRESH_MS = 5 * 60_000;

/** Below this container width the board becomes a single scrollable column. */
const SINGLE_COLUMN_MAX = 400;
const TWO_COLUMN_MAX = 720;

export const ARROW_DIRECTION: Record<string, NudgeDirection | undefined> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};

export const WIDGET_PICKER_ICON: Partial<Record<DashboardWidgetType, IconName>> = {
  next_match: "swords",
  robot_readiness: "cube",
  prediction_summary: "bolt",
  alerts: "bell",
  quick_actions: "grid",
  recent_result: "stats",
  competition_snapshot: "target",
  scouting_coverage: "clipboard",
  sync_status: "gear",
  pit_youtube: "display",
  notifications: "bell",
  ai_usage: "bolt",
  onboarding_checklist: "pin",
  team_todos: "clipboard",
  subteam_upcoming: "calendar",
  my_day: "calendar",
  learn_progress: "target",
  files_recent: "clipboard",
  team_chat: "chat",
  duties: "clipboard",
  budget_parts: "stats",
  attendance: "pin",
  outreach_hours: "clipboard",
  announcements_ack: "bell",
  ask_ai: "chat",
  event_countdown: "calendar",
  hours_month: "clipboard",
  calendar_today: "calendar",
  cad_resources: "cube",
  coding_resources: "gear",
  team_profile: "target",
  alliance_desk: "swords",
  match_schedule: "calendar",
  batteries: "bolt",
  assembly_manual: "cube",
  sponsor_followups: "bell",
  event_readiness: "pin",
  weather_venue: "display",
};

const ROLE_LABEL: Record<OrgRole, string> = {
  owner: "Owner",
  admin: "Admin",
  scout: "Scout",
  viewer: "Viewer",
};

/** Why the catalog is holding a widget back — read straight off the entry. */
export function widgetLockReason(entry: WidgetCatalogEntry): string {
  const roles = entry.roles ?? [];
  if (roles.length === 0) return "Not available on this team";
  const names = roles.map((role) => ROLE_LABEL[role] ?? role);
  if (names.length === 1) return `${names[0]} only`;
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]} only`;
}

export function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/** Phone/tablet/laptop grid, collapsed to one column on a narrow canvas. */
export function resolveGrid(width: number) {
  if (width <= 0) {
    return { ...dashboardGridForWidth(390), cols: 1, rowHeight: 78, margin: [12, 12] as [number, number] };
  }
  if (width < SINGLE_COLUMN_MAX) {
    return { ...dashboardGridForWidth(width), cols: 1, rowHeight: 78, margin: [12, 12] as [number, number] };
  }
  if (width < TWO_COLUMN_MAX) {
    return { ...dashboardGridForWidth(width), cols: 2, rowHeight: 86, margin: [10, 10] as [number, number] };
  }
  return dashboardGridForWidth(width);
}

/** ResizeObserver on the grid canvas — the drag maths needs its exact box. */
export function useMeasuredCanvas() {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [measured, setMeasured] = useState(false);

  useEffect(() => setMounted(true), []);

  // Reflow motion stays off for one frame after the first measurement, so cards
  // snap from the server-render fallback width instead of animating from it.
  useEffect(() => {
    if (width <= 0 || measured) return;
    const frame = window.requestAnimationFrame(() => setMeasured(true));
    // rAF is paused in a background tab; the timer keeps the board from being
    // stuck without reflow motion until the tab is focused.
    const timer = window.setTimeout(() => setMeasured(true), 150);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [width, measured]);

  useEffect(() => {
    if (!node) return;
    setWidth(node.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? node.clientWidth;
      setWidth((current) => (Math.abs(current - next) < 0.5 ? current : next));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);

  return { setNode, node, width, mounted, measured };
}
