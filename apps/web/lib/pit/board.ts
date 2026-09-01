/**
 * Pit Command turnaround board — repairs + batteries + queue from real rows.
 *
 * The board stays empty until at least one evidence flag is set. Turnaround minutes
 * come only from a scheduled match time; there is no DEMO 15-minute leave-pit default.
 * Gate reasons that would invent a CHECK from "no batteries tracked" stay off until
 * the batteries flag is live.
 */

export const PIT_BOARD_POLL_MS = 30_000;

export type PitBoardFlags = {
  /** Open robot_failures rows exist. */
  repairs: boolean;
  /** Tracked (non-retired) battery packs exist. */
  batteries: boolean;
  /** Open maintenance rows or a real next-match row exist. */
  queue: boolean;
};

export type PitRepairRow = {
  id: string;
  subsystem: string;
  severity: string;
  symptoms: string;
  occurredAt: string;
  matchKey: string | null;
  recordedBy: string;
};

export type PitQueueRow = {
  id: string;
  subsystem: string;
  task: string;
  dueAt: string | null;
};

export type PitBatteryRow = {
  id: string;
  assetTag: string;
  status: "active" | "service" | "retired";
  measuredAt: string | null;
  voltage: number | null;
  resistanceMilliohms: number | null;
  gate: "ready" | "review" | "unread";
  health?: string;
};

export type PitNextMatch = {
  matchKey: string;
  compLevel: string;
  matchNumber: number;
  scheduledTime: string | null;
};

export type PitBoardGateState = "empty" | "go" | "check" | "hold";

export type PitBoardGate = {
  state: PitBoardGateState;
  reasons: string[];
};

export type PitTurnaround = {
  minutes: number;
  seconds: number;
  overdue: boolean;
};

export type PitBoardStatus = "empty" | "live";

/** Same 30s cadence as Event Day Command — the board must not go stale on event day. */
export function classifyPitBoardFlags(input: {
  repairRows: number;
  batteryRows: number;
  queueRows: number;
  hasNextMatch?: boolean;
}): PitBoardFlags {
  return {
    repairs: input.repairRows > 0,
    batteries: input.batteryRows > 0,
    queue: input.queueRows > 0 || Boolean(input.hasNextMatch),
  };
}

export function isPitBoardLive(flags: PitBoardFlags): boolean {
  return flags.repairs || flags.batteries || flags.queue;
}

/**
 * Remaining time to a real scheduled match. Null when the timestamp is missing
 * or unparseable — never a DEMO 15-minute turnaround.
 */
export function pitTurnaroundFromSchedule(
  scheduledTime: string | null | undefined,
  now: number = Date.now(),
): PitTurnaround | null {
  if (!scheduledTime) return null;
  const at = Date.parse(scheduledTime);
  if (!Number.isFinite(at)) return null;
  const totalSeconds = Math.round((at - now) / 1000);
  if (totalSeconds <= 0) return { minutes: 0, seconds: 0, overdue: true };
  return {
    minutes: Math.floor(totalSeconds / 60),
    seconds: totalSeconds % 60,
    overdue: false,
  };
}

/** Human label for a real turnaround. Never invents "15m" without a schedule. */
export function pitTurnaroundLabel(turnaround: PitTurnaround | null): string | null {
  if (!turnaround) return null;
  if (turnaround.overdue) return "Queue now";
  if (turnaround.minutes >= 60) {
    return `${Math.floor(turnaround.minutes / 60)}h ${turnaround.minutes % 60}m`;
  }
  return `${turnaround.minutes}m ${turnaround.seconds}s`;
}

function countedBatteries(rows: readonly PitBatteryRow[]) {
  const active = rows.filter((row) => row.status === "active");
  return {
    activeBatteries: active.length,
    readyBatteries: active.filter((row) => row.gate === "ready").length,
  };
}

/**
 * Release gate from real evidence only. Missing batteries do not invent a CHECK
 * until the batteries flag is live.
 */
export function pitBoardGate(input: {
  flags: PitBoardFlags;
  safetyIssues: number;
  disabledIssues: number;
  overdueMaintenance: number;
  readyBatteries: number;
  activeBatteries: number;
}): PitBoardGate {
  if (!isPitBoardLive(input.flags)) {
    return { state: "empty", reasons: [] };
  }

  const reasons: string[] = [];
  if (input.safetyIssues) {
    reasons.push(
      `${input.safetyIssues} unresolved safety issue${input.safetyIssues === 1 ? "" : "s"}`,
    );
  }
  if (input.disabledIssues) {
    reasons.push(
      `${input.disabledIssues} unresolved disabled issue${input.disabledIssues === 1 ? "" : "s"}`,
    );
  }
  if (input.flags.queue && input.overdueMaintenance) {
    reasons.push(
      `${input.overdueMaintenance} overdue maintenance item${input.overdueMaintenance === 1 ? "" : "s"}`,
    );
  }
  if (input.flags.batteries) {
    if (!input.activeBatteries) reasons.push("No active battery is tracked");
    else if (!input.readyBatteries) reasons.push("No active battery is in the ready range");
  }

  if (input.safetyIssues || input.disabledIssues) return { state: "hold", reasons };
  if (reasons.length) return { state: "check", reasons };
  return { state: "go", reasons: ["No release blockers found in Pit Command"] };
}

export function visibleWhenFlag<T>(rows: readonly T[], live: boolean): T[] {
  return live ? [...rows] : [];
}

export type AssemblePitBoardInput = {
  repairs: PitRepairRow[];
  batteries: PitBatteryRow[];
  queue: PitQueueRow[];
  nextMatch: PitNextMatch | null;
  now?: number;
  userId?: string;
  memberRole?: string;
  readyBatteries?: number;
  activeBatteries?: number;
};

export type PitBoardView = {
  status: PitBoardStatus;
  flags: PitBoardFlags;
  repairs: PitRepairRow[];
  batteries: PitBatteryRow[];
  queue: PitQueueRow[];
  /** API alias — same rows as repairs. */
  issues: Array<PitRepairRow & { canResolve: boolean }>;
  /** API alias — same rows as queue. */
  maintenance: PitQueueRow[];
  nextMatch: PitNextMatch | null;
  turnaround: PitTurnaround | null;
  gate: PitBoardGate;
  summary: {
    openIssues: number;
    overdueMaintenance: number;
    readyBatteries: number;
    activeBatteries: number;
  };
};

function canResolveIssue(
  recordedBy: string,
  userId: string | undefined,
  memberRole: string | undefined,
): boolean {
  if (memberRole && ["owner", "admin"].includes(memberRole)) return true;
  return Boolean(userId && recordedBy === userId);
}

/** Assemble the polled board from already-loaded real rows. No invented DEMO totals. */
export function assemblePitBoard(input: AssemblePitBoardInput): PitBoardView {
  const now = input.now ?? Date.now();
  const trackedBatteries = input.batteries.filter((row) => row.status !== "retired");
  const flags = classifyPitBoardFlags({
    repairRows: input.repairs.length,
    batteryRows: trackedBatteries.length,
    queueRows: input.queue.length,
    hasNextMatch: Boolean(input.nextMatch),
  });
  const live = isPitBoardLive(flags);
  const repairs = visibleWhenFlag(input.repairs, flags.repairs);
  const batteries = visibleWhenFlag(trackedBatteries, flags.batteries);
  const queue = visibleWhenFlag(input.queue, flags.queue);
  const counted = countedBatteries(batteries);
  const readyBatteries = input.readyBatteries ?? counted.readyBatteries;
  const activeBatteries = input.activeBatteries ?? counted.activeBatteries;
  const overdueMaintenance = queue.filter(
    (item) => item.dueAt && Date.parse(item.dueAt) < now,
  ).length;
  const safetyIssues = repairs.filter((row) => row.severity === "safety").length;
  const disabledIssues = repairs.filter((row) => row.severity === "disabled").length;

  return {
    status: live ? "live" : "empty",
    flags,
    repairs,
    batteries,
    queue,
    issues: repairs.map((issue) => ({
      ...issue,
      canResolve: canResolveIssue(issue.recordedBy, input.userId, input.memberRole),
    })),
    maintenance: queue,
    nextMatch: flags.queue ? input.nextMatch : null,
    turnaround: pitTurnaroundFromSchedule(input.nextMatch?.scheduledTime, now),
    gate: pitBoardGate({
      flags,
      safetyIssues,
      disabledIssues,
      overdueMaintenance,
      readyBatteries,
      activeBatteries,
    }),
    summary: {
      openIssues: repairs.length,
      overdueMaintenance,
      readyBatteries: flags.batteries ? readyBatteries : 0,
      activeBatteries: flags.batteries ? activeBatteries : 0,
    },
  };
}
