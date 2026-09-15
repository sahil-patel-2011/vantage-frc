/** Live poll for /ai autonomous — steps land in the DB mid-POST. */

export const AUTONOMOUS_LIVE_POLL_MS = 800;
export const AUTONOMOUS_LIVE_POLL_MAX_MS = 4800;

/** 800ms on success; double after each failure, cap 4.8s. */
export function nextAutonomousPollDelayMs(consecutiveFailures: number): number {
  if (!Number.isFinite(consecutiveFailures) || consecutiveFailures <= 0) {
    return AUTONOMOUS_LIVE_POLL_MS;
  }
  const exp = Math.min(Math.floor(consecutiveFailures), 3);
  return Math.min(AUTONOMOUS_LIVE_POLL_MS * 2 ** exp, AUTONOMOUS_LIVE_POLL_MAX_MS);
}

export type LiveAutonomousRun = {
  id: string;
  goal: string;
  status: string;
  finishedAt: string | null;
  provider?: string | null;
  model?: string | null;
  stepCount?: number;
  finalAnswer?: string | null;
  errorClass?: string | null;
  errorMessage?: string | null;
};

export function isAutonomousRunLive(
  run: Pick<LiveAutonomousRun, "status" | "finishedAt"> | null | undefined,
): boolean {
  if (!run) return false;
  if (run.finishedAt) return false;
  return run.status === "running";
}

export function pickLiveAutonomousRun<T extends LiveAutonomousRun>(
  runs: readonly T[],
  goal: string,
): T | null {
  const trimmed = goal.trim();
  const matching = runs.find((run) => isAutonomousRunLive(run) && run.goal === trimmed);
  if (matching) return matching;
  return runs.find((run) => isAutonomousRunLive(run)) ?? null;
}

export function autonomousStartBody(input: {
  orgId: string;
  goal: string;
  runId?: string | null;
}): { orgId: string; goal: string; runId?: string } {
  const body: { orgId: string; goal: string; runId?: string } = {
    orgId: input.orgId,
    goal: input.goal,
  };
  const runId = input.runId?.trim();
  if (runId) body.runId = runId;
  return body;
}

export function autonomousRunHref(orgId: string, runId: string): string {
  return `/api/agent/autonomous?orgId=${encodeURIComponent(orgId)}&runId=${encodeURIComponent(runId)}`;
}

export function autonomousTodosHref(orgId: string, runId: string): string {
  return `/api/agent/todos?orgId=${encodeURIComponent(orgId)}&runId=${encodeURIComponent(runId)}&scope=autonomous`;
}

export function autonomousCancelBody(input: { orgId: string; runId: string }): {
  orgId: string;
  runId: string;
  action: "cancel";
} {
  return { orgId: input.orgId, runId: input.runId, action: "cancel" };
}

export type AutonomousPollTick =
  | { kind: "discover"; runId: string; run: LiveAutonomousRun }
  | { kind: "update"; run: LiveAutonomousRun; steps: unknown[]; done: boolean }
  | { kind: "wait" };

export function nextAutonomousPollTick(input: {
  runId: string | null;
  goal: string;
  listRuns?: readonly LiveAutonomousRun[] | null;
  detail?: { run?: LiveAutonomousRun | null; steps?: unknown[]; setup_required?: boolean } | null;
}): AutonomousPollTick {
  if (input.runId && input.detail) {
    if (input.detail.run) {
      return {
        kind: "update",
        run: input.detail.run,
        steps: input.detail.steps ?? [],
        done: !isAutonomousRunLive(input.detail.run),
      };
    }
    return { kind: "wait" };
  }
  if (!input.runId && input.listRuns) {
    const live = pickLiveAutonomousRun(input.listRuns, input.goal);
    if (live) return { kind: "discover", runId: live.id, run: live };
  }
  return { kind: "wait" };
}
