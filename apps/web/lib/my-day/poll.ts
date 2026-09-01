// My Day live poll — same TBA cache spine as Event Day Command.
// Framework-free so the client and unit tests share pause / widget / merge rules.

import type { MyDayView } from "../my-day";
import type { MyDayShellKind } from "../my-day-related";

/** Event Day Command cadence — next match / bumpers from `matches_ref`. */
export const MY_DAY_POLL_MS = 20_000;

/** Live surfaces refreshed from the TBA cache — never DEMO clocks. */
export const MY_DAY_POLL_WIDGETS = ["next_match", "bumpers"] as const;
export type MyDayPollWidget = (typeof MY_DAY_POLL_WIDGETS)[number];

/** Poll only while the tab is visible — battery-safe for pit tablets. */
export function shouldPollMyDay(
  visibilityState: string | null | undefined,
  pauseWhenHidden = true,
): boolean {
  if (!pauseWhenHidden) return true;
  return visibilityState !== "hidden";
}

/**
 * Widget types this tick should refresh. Ready and empty both need next-match /
 * bumper cues so a TBA sync can surface without a reload. Loading still lists
 * them — the first fetch is separate from the interval.
 */
const POLL_EVERY_SHELL = new Set<MyDayShellKind>(["loading", "error", "setup", "empty", "ready"]);

export function myDayPollWidgetTypes(input?: { shell?: MyDayShellKind | null }): MyDayPollWidget[] {
  if (input?.shell && !POLL_EVERY_SHELL.has(input.shell)) return [];
  return [...MY_DAY_POLL_WIDGETS];
}

/**
 * Overlay a successful poll onto the last good view. Logistics stay if the
 * incoming payload omitted them; next match / bumpers always come from TBA.
 */
export function mergeMyDayView(current: MyDayView | null, incoming: MyDayView): MyDayView {
  if (!current) return incoming;
  if (incoming.status !== "ready" || current.status !== "ready") return incoming;
  return {
    ...current,
    ...incoming,
    next: incoming.next,
    matches: incoming.matches,
    freshness: incoming.freshness,
    logistics: incoming.logistics ?? current.logistics,
    emptyReason: incoming.emptyReason,
  };
}
