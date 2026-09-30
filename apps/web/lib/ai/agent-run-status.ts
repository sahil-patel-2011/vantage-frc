const MAX_LIVE_RUN_AGE_MS = 10 * 60 * 1000;

/** A web request cannot still be running after the function's five-minute cap. */
export function agentRunStoppedUnexpectedly(
  run: { status: string; startedAt: string },
  now = Date.now(),
): boolean {
  const started = Date.parse(run.startedAt);
  return run.status === "running" && Number.isFinite(started) && now - started > MAX_LIVE_RUN_AGE_MS;
}
