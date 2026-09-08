// Pure, unit-testable readiness scoring math. No I/O, no framework imports.

import type {
  CodeVersionStatus,
  ReadinessChecklistItem,
  ReadinessComponents,
  ReadinessFixItem,
  ReadinessFmeaRef,
  ReadinessIndex,
  ReadinessSubsystem,
  ReadinessTier,
  WiringStatus,
} from "./types";

export const WIRING_STATUSES: WiringStatus[] = ["not_started", "in_progress", "verified"];
export const CODE_VERSION_STATUSES: CodeVersionStatus[] = [
  "stale",
  "building",
  "deployed_untested",
  "deployed_tested",
];

/** FRC 2026 R103 robot weight (excluding bumpers and battery). */
export const DEFAULT_WEIGHT_BUDGET_LBS = 115;
/** FRC main breaker rating. */
export const DEFAULT_POWER_BUDGET_AMPS = 120;

export function wiringStatusLabel(status: WiringStatus): string {
  switch (status) {
    case "not_started":
      return "Not started";
    case "in_progress":
      return "In progress";
    case "verified":
      return "Verified";
  }
}

export function codeVersionStatusLabel(status: CodeVersionStatus): string {
  switch (status) {
    case "stale":
      return "Stale";
    case "building":
      return "Building";
    case "deployed_untested":
      return "Deployed, untested";
    case "deployed_tested":
      return "Deployed & tested";
  }
}

function wiringScore(status: WiringStatus): number {
  if (status === "verified") return 1;
  if (status === "in_progress") return 0.5;
  return 0;
}

function codeVersionScore(status: CodeVersionStatus): number {
  if (status === "deployed_tested") return 1;
  if (status === "deployed_untested") return 0.66;
  if (status === "building") return 0.33;
  return 0;
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Combined per-subsystem health used for the stored `health_score` column. */
export function subsystemHealthScore(input: { wiringStatus: WiringStatus; codeVersionStatus: CodeVersionStatus }): number {
  const score = wiringScore(input.wiringStatus) * 0.5 + codeVersionScore(input.codeVersionStatus) * 0.5;
  return Math.round(clamp01(score) * 1000) / 1000;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function tierFromScore(score: number): ReadinessTier {
  if (score >= 0.75) return "ready";
  if (score >= 0.45) return "at_risk";
  return "not_ready";
}

function fmeaRpn(entry: ReadinessFmeaRef): number {
  return entry.severity * entry.occurrence * entry.detection;
}

function fmeaFixSeverity(entry: ReadinessFmeaRef): number {
  return Math.min(10, Math.max(1, Math.round(fmeaRpn(entry) / 100)));
}

export function computeReadinessIndex(input: {
  subsystems: ReadinessSubsystem[];
  checklistItems: ReadinessChecklistItem[];
  openFmeaFailures: ReadinessFmeaRef[];
  weightBudgetLbs?: number;
  powerBudgetAmps?: number;
  /**
   * Recorded totals from the weight and power budgets. They cover lines with no
   * subsystem label (bumpers, battery, the wiring harness), so summing only the
   * per-subsystem attribution would understate the budget. Omitted, the totals
   * fall back to the roster — which is all a caller holding subsystems alone can
   * honestly claim.
   */
  weightUsedLbs?: number;
  powerUsedAmps?: number;
}): ReadinessIndex {
  const weightBudgetLbs = input.weightBudgetLbs ?? DEFAULT_WEIGHT_BUDGET_LBS;
  const powerBudgetAmps = input.powerBudgetAmps ?? DEFAULT_POWER_BUDGET_AMPS;

  const weightUsedLbs =
    input.weightUsedLbs ?? input.subsystems.reduce((sum, s) => sum + s.weightLbs, 0);
  const powerUsedAmps =
    input.powerUsedAmps ?? input.subsystems.reduce((sum, s) => sum + s.powerDrawAmps, 0);
  const weightHeadroom = weightBudgetLbs > 0 ? clamp01(1 - weightUsedLbs / weightBudgetLbs) : 0;
  const powerHeadroom = powerBudgetAmps > 0 ? clamp01(1 - powerUsedAmps / powerBudgetAmps) : 0;

  const subsystemHealth = average(input.subsystems.map((s) => wiringScore(s.wiringStatus)));
  const codeReadiness = average(input.subsystems.map((s) => codeVersionScore(s.codeVersionStatus)));

  const checklistTotal = input.checklistItems.length;
  const checklistComplete = input.checklistItems.filter((c) => c.isComplete).length;
  const checklistCompletion = checklistTotal > 0 ? checklistComplete / checklistTotal : 0;

  const openFmea = input.openFmeaFailures.filter((f) => f.status === "open" || f.status === "fixing");
  const highSeverityFmea = openFmea.filter((f) => f.severity >= 7);
  const fmeaClearance =
    openFmea.length === 0 ? 1 : clamp01(1 - (openFmea.length * 0.15 + highSeverityFmea.length * 0.1));

  const components: ReadinessComponents = {
    subsystemHealth: Math.round(subsystemHealth * 1000) / 1000,
    codeReadiness: Math.round(codeReadiness * 1000) / 1000,
    fmeaClearance: Math.round(fmeaClearance * 1000) / 1000,
    weightHeadroom: Math.round(weightHeadroom * 1000) / 1000,
    powerHeadroom: Math.round(powerHeadroom * 1000) / 1000,
    checklistCompletion: Math.round(checklistCompletion * 1000) / 1000,
  };

  const score =
    components.subsystemHealth * 0.2 +
    components.codeReadiness * 0.2 +
    components.fmeaClearance * 0.25 +
    components.weightHeadroom * 0.1 +
    components.powerHeadroom * 0.1 +
    components.checklistCompletion * 0.15;

  const fixList: ReadinessFixItem[] = [];

  for (const failure of openFmea) {
    fixList.push({
      id: `fmea-${failure.id}`,
      label: failure.title,
      reason: `Open FMEA on ${failure.subsystemName} — RPN ${fmeaRpn(failure)} (${failure.status})`,
      severity: fmeaFixSeverity(failure),
      category: "fmea",
    });
  }

  for (const subsystem of input.subsystems) {
    if (subsystem.wiringStatus !== "verified") {
      fixList.push({
        id: `wiring-${subsystem.id}`,
        label: `Verify wiring — ${subsystem.name}`,
        reason: `Wiring is ${wiringStatusLabel(subsystem.wiringStatus).toLowerCase()}`,
        severity: subsystem.wiringStatus === "not_started" ? 8 : 5,
        category: "wiring",
      });
    }
    if (subsystem.codeVersionStatus !== "deployed_tested") {
      fixList.push({
        id: `code-${subsystem.id}`,
        label: `Deploy & test code — ${subsystem.name}`,
        reason: `Code is ${codeVersionStatusLabel(subsystem.codeVersionStatus).toLowerCase()}`,
        severity:
          subsystem.codeVersionStatus === "stale"
            ? 8
            : subsystem.codeVersionStatus === "building"
              ? 6
              : 4,
        category: "code",
      });
    }
  }

  if (weightUsedLbs > 0 && weightHeadroom < 0.1) {
    fixList.push({
      id: "weight-budget",
      label: "Reduce robot weight",
      reason: `${weightUsedLbs.toFixed(1)} lbs recorded against a ${weightBudgetLbs} lbs budget`,
      severity: 9,
      category: "weight",
    });
  }
  if (powerUsedAmps > 0 && powerHeadroom < 0.1) {
    fixList.push({
      id: "power-budget",
      label: "Reduce power draw",
      reason: `${powerUsedAmps.toFixed(1)} A recorded against a ${powerBudgetAmps} A main breaker`,
      severity: 9,
      category: "power",
    });
  }

  for (const item of input.checklistItems.filter((c) => !c.isComplete)) {
    fixList.push({
      id: `checklist-${item.id}`,
      label: item.label,
      reason: item.subsystemName ? `Bring-up checklist — ${item.subsystemName}` : "Bring-up checklist",
      severity: 4,
      category: "bringup",
    });
  }

  fixList.sort((a, b) => b.severity - a.severity);

  return {
    score: Math.round(clamp01(score) * 1000) / 1000,
    tier: tierFromScore(clamp01(score)),
    components,
    weightUsedLbs: Math.round(weightUsedLbs * 100) / 100,
    weightBudgetLbs,
    powerUsedAmps: Math.round(powerUsedAmps * 100) / 100,
    powerBudgetAmps,
    openFmeaCount: openFmea.length,
    highSeverityFmeaCount: highSeverityFmea.length,
    checklistTotal,
    checklistComplete,
    fixList: fixList.slice(0, 30),
  };
}
