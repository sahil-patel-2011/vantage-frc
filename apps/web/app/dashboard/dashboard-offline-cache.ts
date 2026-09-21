import { layoutOrAudienceDefault, type DashboardWidgetLayout } from "../../lib/dashboard/catalog";
import type { WidgetPayload } from "../../lib/dashboard/snapshot";
import type { BoardMeta, BoardState } from "./dashboard-board-types";

/** Last-good Home payload kept in IndexedDB for cold offline visits. */
export type DashboardOfflineCache = {
  role: string | null;
  canShareOrg: boolean;
  boards: BoardMeta[];
  board: BoardState | null;
  scope: "personal" | "org";
  layout: DashboardWidgetLayout[];
  widgets: Record<string, WidgetPayload>;
  context: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isDashboardOfflineCache(value: unknown): value is DashboardOfflineCache {
  if (!isRecord(value)) return false;
  if (value.role !== null && typeof value.role !== "string") return false;
  if (typeof value.canShareOrg !== "boolean") return false;
  if (!Array.isArray(value.boards)) return false;
  if (value.board !== null && !isRecord(value.board)) return false;
  if (value.scope !== "personal" && value.scope !== "org") return false;
  if (!Array.isArray(value.layout)) return false;
  if (!isRecord(value.widgets)) return false;
  if (!isRecord(value.context)) return false;
  return true;
}

function homeAudienceFromContext(context: Record<string, unknown>): "mentor" | "student" {
  const strip = context.homeStrip;
  if (isRecord(strip) && strip.audience === "mentor") return "mentor";
  return "student";
}

/** Normalize missing layouts, preserving a board the user deliberately cleared. */
export function normalizeDashboardCache(cache: DashboardOfflineCache): DashboardOfflineCache {
  const audience = homeAudienceFromContext(cache.context);
  return {
    ...cache,
    layout: layoutOrAudienceDefault(!cache.board?.id && !cache.layout.length ? undefined : cache.layout, audience),
  };
}

/** Shape a live `/api/dashboards?mode=home` body into the cache row. */
export function dashboardCacheFromHomePayload(data: {
  role?: string | null;
  canShareOrg?: boolean;
  boards?: unknown;
  active?: BoardState | null;
  widgets?: Record<string, WidgetPayload>;
  context?: Record<string, unknown>;
}): DashboardOfflineCache {
  const context = data.context ?? {};
  const audience = homeAudienceFromContext(context);
  return {
    role: data.role ?? null,
    canShareOrg: Boolean(data.canShareOrg),
    boards: Array.isArray(data.boards) ? (data.boards as BoardMeta[]) : [],
    board: data.active ?? null,
    scope: data.active?.scope === "org" ? "org" : "personal",
    layout: layoutOrAudienceDefault(!data.active?.id && !data.active?.layout?.length ? undefined : data.active?.layout, audience),
    widgets: data.widgets ?? {},
    context,
  };
}
