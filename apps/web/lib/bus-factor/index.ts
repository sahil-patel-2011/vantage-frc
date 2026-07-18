// Bus-factor / burnout early-warning aggregation. Pure functions over logged workload
// entries — deterministic given input, no clock, no I/O. An empty entry list yields an
// empty (zero-risk) summary rather than a fabricated score.

export * from "./types";

import type {
  AreaConcentration,
  BusFactorArea,
  BusFactorSummary,
  MemberWorkload,
  RiskFlag,
  RiskLevel,
  WorkloadEntry,
} from "./types";

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const round1 = (value: number) => Math.round(value * 10) / 10;
const round3 = (value: number) => Math.round(value * 1000) / 1000;

export const BUS_FACTOR_AREAS: BusFactorArea[] = [
  "mechanical",
  "electrical",
  "software",
  "strategy",
  "scouting",
  "business",
  "admin",
  "other",
];

export function busFactorAreaLabel(area: BusFactorArea): string {
  const labels: Record<BusFactorArea, string> = {
    mechanical: "Mechanical",
    electrical: "Electrical",
    software: "Software",
    strategy: "Strategy",
    scouting: "Scouting",
    business: "Business",
    admin: "Admin / logistics",
    other: "Other",
  };
  return labels[area];
}

/** Overload threshold: a member logging more than this multiple of the team mean is flagged. */
const OVERLOAD_RATIO_THRESHOLD = 1.6;
/** Concentration threshold: an area where one person carries this share (or more) is flagged. */
const CONCENTRATION_SHARE_THRESHOLD = 0.75;
/** An area needs at least this many contributors to not be flagged as single-point-of-failure. */
const MIN_HEALTHY_CONTRIBUTORS = 2;

export type BusFactorTargets = {
  overloadRatioThreshold: number;
  concentrationShareThreshold: number;
  minHealthyContributors: number;
};

export const DEFAULT_BUS_FACTOR_TARGETS: BusFactorTargets = {
  overloadRatioThreshold: OVERLOAD_RATIO_THRESHOLD,
  concentrationShareThreshold: CONCENTRATION_SHARE_THRESHOLD,
  minHealthyContributors: MIN_HEALTHY_CONTRIBUTORS,
};

function riskLevelFor(score: number): RiskLevel {
  if (score >= 0.6) return "high";
  if (score >= 0.3) return "watch";
  return "low";
}

/**
 * Aggregate weekly workload entries into per-area concentration, per-member workload,
 * risk flags, and an overall 0..1 risk score. Pure — no I/O, no fabricated data: an
 * empty `entries` array yields a fully zeroed, "low" risk summary.
 */
export function summarizeBusFactor(
  entries: WorkloadEntry[],
  targets: Partial<BusFactorTargets> = {},
): BusFactorSummary {
  const t = { ...DEFAULT_BUS_FACTOR_TARGETS, ...targets };

  const weeks = new Set<string>();
  const memberMap = new Map<
    string,
    { name: string; hours: number; tasksOwned: number; soleKnowledge: number; areas: Set<BusFactorArea> }
  >();
  const areaMap = new Map<
    string,
    { hours: number; tasksOwned: number; soleKnowledge: number; byMember: Map<string, { name: string; hours: number }> }
  >();

  for (const entry of entries) {
    weeks.add(entry.weekStart);

    const member = memberMap.get(entry.memberUserId) ?? {
      name: entry.memberName,
      hours: 0,
      tasksOwned: 0,
      soleKnowledge: 0,
      areas: new Set<BusFactorArea>(),
    };
    member.hours += Math.max(0, entry.hoursLogged || 0);
    member.tasksOwned += Math.max(0, entry.tasksOwned || 0);
    member.soleKnowledge += Math.max(0, entry.soleKnowledgeCount || 0);
    member.areas.add(entry.area);
    memberMap.set(entry.memberUserId, member);

    const area = areaMap.get(entry.area) ?? {
      hours: 0,
      tasksOwned: 0,
      soleKnowledge: 0,
      byMember: new Map<string, { name: string; hours: number }>(),
    };
    area.hours += Math.max(0, entry.hoursLogged || 0);
    area.tasksOwned += Math.max(0, entry.tasksOwned || 0);
    area.soleKnowledge += Math.max(0, entry.soleKnowledgeCount || 0);
    const byMember = area.byMember.get(entry.memberUserId) ?? { name: entry.memberName, hours: 0 };
    byMember.hours += Math.max(0, entry.hoursLogged || 0);
    area.byMember.set(entry.memberUserId, byMember);
    areaMap.set(entry.area, area);
  }

  const activeMembers = memberMap.size;
  const totalHours = round1([...memberMap.values()].reduce((sum, m) => sum + m.hours, 0));
  const meanWeeklyHoursPerMember =
    activeMembers > 0 && weeks.size > 0 ? round1(totalHours / activeMembers / weeks.size) : 0;
  const meanMemberHours = activeMembers > 0 ? totalHours / activeMembers : 0;

  const flags: RiskFlag[] = [];

  const areaConcentration: AreaConcentration[] = [...areaMap.entries()]
    .map(([area, value]) => {
      const contributors = value.byMember.size;
      let topName: string | null = null;
      let topHours = 0;
      for (const contributor of value.byMember.values()) {
        if (contributor.hours > topHours) {
          topHours = contributor.hours;
          topName = contributor.name;
        }
      }
      const topShare = value.hours > 0 ? topHours / value.hours : 0;
      const concentrationScore =
        value.hours > 0
          ? clamp01(topShare)
          : contributors > 0 && contributors < t.minHealthyContributors
            ? 1
            : 0;

      if (
        (value.hours > 0 && topShare >= t.concentrationShareThreshold) ||
        contributors === 1
      ) {
        flags.push({
          id: `concentration-${area}`,
          level: contributors === 1 ? "high" : "watch",
          kind: "concentration",
          memberName: topName,
          area: area as BusFactorArea,
          detail:
            contributors === 1
              ? `${topName ?? "One person"} is the only contributor logged for ${busFactorAreaLabel(area as BusFactorArea)} — single point of failure.`
              : `${topName ?? "One member"} carries ${Math.round(topShare * 100)}% of ${busFactorAreaLabel(area as BusFactorArea)} hours.`,
        });
      }
      if (value.soleKnowledge > 0) {
        flags.push({
          id: `sole-knowledge-${area}`,
          level: value.soleKnowledge >= 2 ? "high" : "watch",
          kind: "sole_knowledge",
          memberName: topName,
          area: area as BusFactorArea,
          detail: `${value.soleKnowledge} task(s) in ${busFactorAreaLabel(area as BusFactorArea)} are known by only one member.`,
        });
      }

      return {
        area: area as BusFactorArea,
        contributors,
        totalHours: round1(value.hours),
        totalTasksOwned: value.tasksOwned,
        totalSoleKnowledge: value.soleKnowledge,
        concentrationScore: round3(concentrationScore),
        topContributorName: topName,
        topContributorShare: round3(topShare),
      };
    })
    .sort((a, b) => b.concentrationScore - a.concentrationScore || b.totalHours - a.totalHours);

  const memberWorkloads: MemberWorkload[] = [...memberMap.entries()]
    .map(([memberUserId, value]) => {
      const overloadRatio = meanMemberHours > 0 ? value.hours / meanMemberHours : 0;
      if (overloadRatio >= t.overloadRatioThreshold) {
        flags.push({
          id: `overload-${memberUserId}`,
          level: overloadRatio >= t.overloadRatioThreshold * 1.25 ? "high" : "watch",
          kind: "overload",
          memberName: value.name,
          area: null,
          detail: `${value.name} logged ${round1(value.hours)}h — ${round1(overloadRatio)}x the team average.`,
        });
      }
      return {
        memberUserId,
        memberName: value.name,
        totalHours: round1(value.hours),
        totalTasksOwned: value.tasksOwned,
        totalSoleKnowledge: value.soleKnowledge,
        areas: [...value.areas],
        overloadRatio: round3(overloadRatio),
      };
    })
    .sort((a, b) => b.totalHours - a.totalHours);

  flags.sort((a, b) => {
    const order: Record<RiskLevel, number> = { high: 0, watch: 1, low: 2 };
    return order[a.level] - order[b.level];
  });

  const concentrationSignal =
    areaConcentration.length > 0
      ? areaConcentration.reduce((sum, a) => sum + a.concentrationScore, 0) / areaConcentration.length
      : 0;
  const overloadSignal =
    memberWorkloads.length > 0
      ? clamp01(
          Math.max(0, ...memberWorkloads.map((m) => m.overloadRatio - 1)) /
            (t.overloadRatioThreshold - 1 || 1),
        )
      : 0;
  const soleKnowledgeTotal = areaConcentration.reduce((sum, a) => sum + a.totalSoleKnowledge, 0);
  const soleKnowledgeSignal = clamp01(soleKnowledgeTotal / Math.max(3, activeMembers));

  const riskScore =
    entries.length === 0
      ? 0
      : round3(clamp01(0.45 * concentrationSignal + 0.35 * overloadSignal + 0.2 * soleKnowledgeSignal));

  return {
    weeksCovered: weeks.size,
    activeMembers,
    totalHours,
    meanWeeklyHoursPerMember,
    areaConcentration,
    memberWorkloads,
    flags,
    riskScore,
    riskLevel: riskLevelFor(riskScore),
  };
}
