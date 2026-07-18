import type { MyDayView } from "./my-day";

export type EventFocusTone = "live" | "stale" | "offline";

export type EventFocusView = {
  id: string;
  title: string;
  detail: string;
  freshness: string;
  tone: EventFocusTone;
  actions: Array<{ label: string; href: string; emphasis: "primary" | "secondary" }>;
};

const STALE_AFTER_MS = 20 * 60_000;

export function buildEventFocus(
  view: MyDayView | null | undefined,
  online: boolean,
  now = Date.now(),
): EventFocusView | null {
  if (view?.status !== "ready" || !view.next) return null;
  const syncedAt = view.freshness.syncedAt ? new Date(view.freshness.syncedAt).getTime() : Number.NaN;
  const stale = !Number.isFinite(syncedAt) || now - syncedAt > STALE_AFTER_MS;
  const tone: EventFocusTone = !online ? "offline" : stale ? "stale" : "live";
  const freshness = !online
    ? "Offline · saved data"
    : stale
      ? `${view.freshness.label} · verify queue`
      : view.freshness.label;

  return {
    id: view.next.matchKey,
    title: `Next · ${view.next.matchLabel}`,
    detail: [view.next.bumperCue, view.next.timeLabel].filter(Boolean).join(" · "),
    freshness,
    tone,
    actions: [
      { label: "Brief", href: view.next.links.briefing, emphasis: "primary" },
      { label: "Checklist", href: view.next.links.checklist, emphasis: "secondary" },
      { label: "Command", href: view.next.links.command, emphasis: "secondary" },
    ],
  };
}
