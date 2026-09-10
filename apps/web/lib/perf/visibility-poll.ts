/** Hidden-tab polls should not burn Vercel credits at the same rate as a live pit screen. */
export const HIDDEN_POLL_MULTIPLIER = 4;
export const HIDDEN_POLL_FLOOR_MS = 120_000;

export function visibilityPollDelay(visibleMs: number, hidden: boolean): number {
  const visible = Math.max(0, Math.floor(visibleMs));
  if (!hidden) return visible;
  return Math.max(visible * HIDDEN_POLL_MULTIPLIER, HIDDEN_POLL_FLOOR_MS);
}
