// Pure FMEA scoring + season summary. Deterministic; no I/O.

import type {
  FmeaContext,
  FmeaEvaluation,
  FmeaFailure,
  FmeaLevel,
  FmeaStatus,
  FmeaSummary,
  SubsystemFailureProfile,
} from "./types";

const CONTEXT_ORDER: FmeaContext[] = ["match", "pit", "practice", "inspection", "other"];
const ALL_STATUSES: FmeaStatus[] = ["open", "fixing", "verified", "closed"];
const ALL_LEVELS: FmeaLevel[] = ["low", "moderate", "high", "critical"];

const ACTIVE: ReadonlySet<FmeaStatus> = new Set<FmeaStatus>(["open", "fixing"]);

const clampScale = (value: number) => Math.min(10, Math.max(1, Math.round(value || 1)));
const round = (value: number, places = 1) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

export function fmeaContextLabel(context: FmeaContext): string {
  const labels: Record<FmeaContext, string> = {
    match: "In match",
    pit: "Pit",
    practice: "Practice",
    inspection: "Inspection",
    other: "Other",
  };
  return labels[context];
}

export function fmeaStatusLabel(status: FmeaStatus): string {
  const labels: Record<FmeaStatus, string> = {
    open: "Open",
    fixing: "Fixing",
    verified: "Verified",
    closed: "Closed",
  };
  return labels[status];
}

export function fmeaLevelLabel(level: FmeaLevel): string {
  const labels: Record<FmeaLevel, string> = {
    low: "Low",
    moderate: "Moderate",
    high: "High",
    critical: "Critical",
  };
  return labels[level];
}

/** Classic FMEA RPN bands on a 1–1000 scale (O×S×D with 1–10 factors). */
export function levelForRpn(rpn: number): FmeaLevel {
  if (rpn >= 200) return "critical";
  if (rpn >= 100) return "high";
  if (rpn >= 40) return "moderate";
  return "low";
}

export function evaluateFailure(failure: FmeaFailure): FmeaEvaluation {
  const rpn = clampScale(failure.occurrence) * clampScale(failure.severity) * clampScale(failure.detection);
  const active = ACTIVE.has(failure.status);
  const needsFix = active && !(failure.fix && failure.fix.trim());
  return { failure, rpn, level: levelForRpn(rpn), active, needsFix };
}

export function summarizeFailures(failures: FmeaFailure[]): FmeaSummary {
  const evaluations = failures.map((failure) => evaluateFailure(failure));
  const active = evaluations.filter((e) => e.active);

  const byLevel = ALL_LEVELS.reduce((acc, level) => ({ ...acc, [level]: 0 }), {} as Record<FmeaLevel, number>);
  for (const e of active) byLevel[e.level] += 1;

  const byStatus = ALL_STATUSES.reduce((acc, status) => ({ ...acc, [status]: 0 }), {} as Record<FmeaStatus, number>);
  for (const e of evaluations) byStatus[e.failure.status] += 1;

  const contextMap = new Map<FmeaContext, number>();
  for (const e of evaluations) {
    contextMap.set(e.failure.context, (contextMap.get(e.failure.context) ?? 0) + 1);
  }
  const byContext = [...contextMap.entries()]
    .map(([context, count]) => ({ context, count }))
    .sort(
      (a, b) =>
        b.count - a.count || CONTEXT_ORDER.indexOf(a.context) - CONTEXT_ORDER.indexOf(b.context),
    );

  const subMap = new Map<
    string,
    { subsystemId: string | null; count: number; openCount: number; rpnSum: number; maxRpn: number }
  >();
  for (const e of evaluations) {
    const key = e.failure.subsystemName.trim().toLowerCase() || "unknown";
    const entry = subMap.get(key) ?? {
      subsystemId: e.failure.subsystemId,
      count: 0,
      openCount: 0,
      rpnSum: 0,
      maxRpn: 0,
    };
    entry.count += 1;
    if (e.active) entry.openCount += 1;
    entry.rpnSum += e.rpn;
    entry.maxRpn = Math.max(entry.maxRpn, e.rpn);
    if (!entry.subsystemId && e.failure.subsystemId) entry.subsystemId = e.failure.subsystemId;
    subMap.set(key, entry);
  }
  const bySubsystem: SubsystemFailureProfile[] = [...subMap.entries()]
    .map(([key, value]) => {
      const avgRpn = value.count > 0 ? round(value.rpnSum / value.count) : 0;
      return {
        subsystemName: failures.find((f) => f.subsystemName.trim().toLowerCase() === key)?.subsystemName ?? key,
        subsystemId: value.subsystemId,
        count: value.count,
        openCount: value.openCount,
        avgRpn,
        maxRpn: value.maxRpn,
        level: levelForRpn(avgRpn),
      };
    })
    .sort((a, b) => b.count - a.count || b.avgRpn - a.avgRpn || a.subsystemName.localeCompare(b.subsystemName));

  const byRpnDesc = (a: FmeaEvaluation, b: FmeaEvaluation) =>
    b.rpn - a.rpn ||
    b.failure.severity - a.failure.severity ||
    a.failure.title.localeCompare(b.failure.title);

  const topFailures = [...active].sort(byRpnDesc).slice(0, 6);
  const needsFix = active.filter((e) => e.needsFix).sort(byRpnDesc);
  const highestRpn = active.reduce((max, e) => Math.max(max, e.rpn), 0);
  const avgRpn = active.length > 0 ? round(active.reduce((sum, e) => sum + e.rpn, 0) / active.length) : 0;

  return {
    total: failures.length,
    active: active.length,
    byLevel,
    byStatus,
    byContext,
    bySubsystem,
    topFailures,
    needsFix,
    highestRpn,
    avgRpn,
  };
}
