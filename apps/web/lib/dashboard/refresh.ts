import type { DashboardWidgetType } from "./catalog";
import type { WidgetPayload } from "./snapshot";
import type { DashboardShellKind } from "./dashboard-related";
import { visibilityPollDelay } from "../perf/visibility-poll";

export const DASHBOARD_POLL_MS = 30_000;
export const DASHBOARD_HIDDEN_POLL_MS = 120_000;

/** Visibility-aware Home poll. Hidden tabs should not burn Vercel credits. */
export function dashboardPollDelay(hidden: boolean): number {
  return visibilityPollDelay(DASHBOARD_POLL_MS, hidden);
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
/**
 * Widgets the page asks for even when the board does not show them.
 *
 * "What to do now" reads today's calendar to say "Build night — today at
 * 6 PM", and it is not a widget, so nothing in the layout asks for the data
 * it needs. Without this the card could only mention a practice on boards
 * that happened to have the Calendar card on them, which is a feature that
 * works for some teams and silently does not for others.
 *
 * Deliberately a short list. Every entry is a query on every refresh for
 * something that may not be on screen, so it earns its place by feeding a
 * part of the page that is always there.
 */
export const HOME_ALWAYS_LOADED: DashboardWidgetType[] = ["calendar_today"];

export function snapshotPollWidgetTypes(
  layout: Array<{ type: DashboardWidgetType }>,
  input: { shell: DashboardShellKind },
): DashboardWidgetType[] {
  const ready = input.shell === "ready";
  return [...new Set([...layout.map((item) => item.type), ...HOME_ALWAYS_LOADED])].filter(
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
