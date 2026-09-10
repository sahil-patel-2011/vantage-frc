import type { DashboardWidgetType } from "./catalog";
import type { WidgetPayload } from "./snapshot";
import type { DashboardShellKind } from "./dashboard-related";

export const DASHBOARD_POLL_MS = 30_000;
export const DASHBOARD_HIDDEN_POLL_MS = 120_000;

/** Visibility-aware Home poll. Hidden tabs should not burn Vercel credits. */
export function dashboardPollDelay(hidden: boolean): number {
  return hidden ? DASHBOARD_HIDDEN_POLL_MS : DASHBOARD_POLL_MS;
}

const POLL_SKIP_WHEN_READY = new Set<DashboardWidgetType>(["onboarding_checklist", "quick_actions"]);

/** Home-strip + data-source health belong on bootstrap / slow refresh, not every poll. */
export function snapshotShouldLoadHomeStrip(input: {
  includeHomeStrip?: boolean;
  widgetTypes?: DashboardWidgetType[];
}): boolean {
  if (typeof input.includeHomeStrip === "boolean") return input.includeHomeStrip;
  return input.widgetTypes === undefined;
}

export function snapshotWantsFullContext(url: URL): boolean {
  return url.searchParams.get("context") === "full";
}

/**
 * Live widgets only. Ready Home hides setup cards, so polling them just burns
 * SQL on work the view will throw away.
 */
export function snapshotPollWidgetTypes(
  layout: Array<{ type: DashboardWidgetType }>,
  input: { shell: DashboardShellKind },
): DashboardWidgetType[] {
  const ready = input.shell === "ready";
  return [...new Set(layout.map((item) => item.type))].filter(
    (type) => !(ready && POLL_SKIP_WHEN_READY.has(type)),
  );
}

export function mergeDashboardContext(
  current: Record<string, unknown>,
  incoming: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!incoming) return current;
  const next = { ...current };
  for (const [key, value] of Object.entries(incoming)) {
    if (value !== undefined) next[key] = value;
  }
  return next;
}

export function mergeDashboardWidgets(
  current: Record<string, WidgetPayload>,
  incoming: Record<string, WidgetPayload> | undefined,
): Record<string, WidgetPayload> {
  if (!incoming) return current;
  return { ...current, ...incoming };
}
