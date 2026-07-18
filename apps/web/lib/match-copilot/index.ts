// Match Copilot pure helpers — no I/O, unit-testable. compute-match-copilot.ts
// loads the raw rows from Postgres and hands them to these functions.

import type {
  BatteryHealthFlag,
  MatchCopilotAlliance,
  MatchCopilotBattery,
  MatchCopilotCallout,
  MatchCopilotRisk,
  MatchCopilotTeam,
} from "./types";

export function teamKeyForNumber(teamNumber: number): string {
  return `frc${teamNumber}`;
}

export function teamNumberFromKey(teamKey: string): number | null {
  const match = /^frc(\d+)$/.exec(teamKey.trim());
  return match ? Number(match[1]) : null;
}

export function allianceTeamKeys(alliance: unknown): string[] {
  if (!alliance || typeof alliance !== "object") return [];
  const keys = (alliance as { teamKeys?: unknown }).teamKeys;
  return Array.isArray(keys) ? keys.filter((key): key is string => typeof key === "string") : [];
}

/** Standard FMEA risk-priority-number: occurrence * severity * detection, each 1..10. */
export function computeRpn(occurrence: number, severity: number, detection: number): number {
  return occurrence * severity * detection;
}

/**
 * 0..1 pack health blending resting voltage and internal resistance against the
 * rough SLA-pack bands used elsewhere in the platform (healthy ~6-12 mOhm /
 * >=12.5V resting). Returns a neutral "watch" reading when nothing was measured
 * rather than inventing a score.
 */
export function batteryHealth(input: {
  restingVoltage: number | null;
  resistanceMilliohms: number | null;
}): { healthScore: number; flag: BatteryHealthFlag } {
  const { restingVoltage, resistanceMilliohms } = input;
  if (restingVoltage == null && resistanceMilliohms == null) {
    return { healthScore: 0.5, flag: "watch" };
  }
  let score = 1;
  if (resistanceMilliohms != null) {
    score = Math.min(score, 1 - (resistanceMilliohms - 8) / 22);
  }
  if (restingVoltage != null) {
    score = Math.min(score, (restingVoltage - 11.5) / 1.5);
  }
  score = Math.max(0, Math.min(1, score));
  const flag: BatteryHealthFlag = score < 0.35 ? "critical" : score < 0.65 ? "watch" : "healthy";
  return { healthScore: score, flag };
}

export function averageEpa(teams: MatchCopilotTeam[]): number | null {
  const values = teams.map((t) => t.epaTotal).filter((v): v is number => v != null);
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function teamLabel(team: MatchCopilotTeam): string {
  return team.nickname ? `${team.nickname} (#${team.teamNumber})` : `Team ${team.teamNumber}`;
}

/**
 * Deterministically prioritize up to 3 do-this callouts fusing opponent EPA,
 * our stored strategy plan, open FMEA risks, and battery fleet health. Pure —
 * no I/O — so identical inputs always produce identical output.
 */
export function composeMatchCopilotCallouts(input: {
  alliance: MatchCopilotAlliance;
  opponents: MatchCopilotTeam[];
  ourEpaTotal: number | null;
  hasStrategyPlan: boolean;
  strategySummary: string | null;
  openRisks: MatchCopilotRisk[];
  batteryFleet: MatchCopilotBattery[];
}): MatchCopilotCallout[] {
  const candidates: MatchCopilotCallout[] = [];

  // 1. Opponent scouting/EPA — the strongest opponent this match.
  const strongest = [...input.opponents]
    .filter((t) => t.epaTotal != null)
    .sort((a, b) => (b.epaTotal ?? 0) - (a.epaTotal ?? 0))[0];
  if (strongest && strongest.epaTotal != null) {
    const gap = input.ourEpaTotal != null ? strongest.epaTotal - input.ourEpaTotal : null;
    candidates.push({
      priority: 1,
      category: "opponent",
      headline: `Plan around ${teamLabel(strongest)}`,
      detail:
        gap != null
          ? `Highest-EPA opponent at ${strongest.epaTotal.toFixed(1)} (${gap > 0 ? "+" : ""}${gap.toFixed(1)} vs our ${input.ourEpaTotal!.toFixed(1)}). Assign defense/priority accordingly.`
          : `Highest-EPA opponent this match at ${strongest.epaTotal.toFixed(1)}.`,
      sourceRefs: [strongest.teamKey],
    });
  }

  // 2. Open FMEA risk with the highest RPN.
  const topRisk = [...input.openRisks].sort((a, b) => b.rpn - a.rpn)[0];
  if (topRisk) {
    candidates.push({
      priority: 1,
      category: "risk",
      headline: `Mitigate: ${topRisk.title}`,
      detail: `${topRisk.subsystemName} — RPN ${topRisk.rpn} (O${topRisk.occurrence}/S${topRisk.severity}/D${topRisk.detection}). Confirm the fix or a workaround before this match.`,
      sourceRefs: [topRisk.id],
    });
  }

  // 3. Worst-flagged active battery pack.
  const worstBattery = [...input.batteryFleet]
    .filter((b) => b.status === "active" && b.flag !== "healthy")
    .sort((a, b) => a.healthScore - b.healthScore)[0];
  if (worstBattery) {
    candidates.push({
      priority: 2,
      category: "battery",
      headline: `${worstBattery.flag === "critical" ? "Swap" : "Watch"} battery ${worstBattery.label}`,
      detail:
        worstBattery.resistanceMilliohms != null
          ? `Internal resistance ${worstBattery.resistanceMilliohms.toFixed(1)} mOhm — ${
              worstBattery.flag === "critical" ? "retire or swap before queuing" : "monitor before queuing"
            }.`
          : `Health signal is ${worstBattery.flag} — ${
              worstBattery.flag === "critical" ? "swap before queuing" : "keep an eye on it"
            }.`,
      sourceRefs: [worstBattery.id],
    });
  }

  // 4. Our stored strategy plan (or the lack of one).
  if (input.hasStrategyPlan && input.strategySummary) {
    candidates.push({
      priority: 2,
      category: "strategy",
      headline: "Run the stored plan",
      detail: input.strategySummary.slice(0, 240),
      sourceRefs: [],
    });
  } else {
    candidates.push({
      priority: 3,
      category: "strategy",
      headline: "No stored plan for this match",
      detail: "Build a quick match strategy before queuing — Strategy already has the opponent alliance loaded.",
      sourceRefs: [],
    });
  }

  return candidates
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 3)
    .map((callout, index) => ({ ...callout, priority: (index + 1) as 1 | 2 | 3 }));
}
