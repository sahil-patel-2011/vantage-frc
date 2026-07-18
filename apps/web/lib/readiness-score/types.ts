// Robot Readiness Score domain types. Pure data shapes — no I/O, no framework imports.
// Grounds one ship-readiness index in real, team-recorded state: subsystem wiring/code
// status, weight/power headroom, the bring-up checklist, and open FMEA — never fabricated.

export type WiringStatus = "not_started" | "in_progress" | "verified";

export type CodeVersionStatus = "stale" | "building" | "deployed_untested" | "deployed_tested";

export type ReadinessTier = "not_ready" | "at_risk" | "ready";

export type ReadinessSubsystem = {
  id: string;
  name: string;
  weightLbs: number;
  powerDrawAmps: number;
  wiringStatus: WiringStatus;
  codeVersionStatus: CodeVersionStatus;
  healthScore: number;
  notes: string | null;
  updatedAt: string;
};

export type ReadinessChecklistItem = {
  id: string;
  subsystemName: string | null;
  label: string;
  isComplete: boolean;
  sequence: number;
  createdAt: string;
};

export type ReadinessFmeaRef = {
  id: string;
  title: string;
  subsystemName: string;
  severity: number;
  occurrence: number;
  detection: number;
  status: string;
};

export type ReadinessFixCategory = "fmea" | "wiring" | "code" | "bringup" | "weight" | "power";

export type ReadinessFixItem = {
  id: string;
  label: string;
  reason: string;
  /** 1 (low) .. 10 (highest urgency) — used to order the fix list. */
  severity: number;
  category: ReadinessFixCategory;
};

export type ReadinessComponents = {
  subsystemHealth: number;
  codeReadiness: number;
  fmeaClearance: number;
  weightHeadroom: number;
  powerHeadroom: number;
  checklistCompletion: number;
};

export type ReadinessIndex = {
  /** 0..1 overall ship-readiness score. */
  score: number;
  tier: ReadinessTier;
  components: ReadinessComponents;
  weightUsedLbs: number;
  weightBudgetLbs: number;
  powerUsedAmps: number;
  powerBudgetAmps: number;
  openFmeaCount: number;
  highSeverityFmeaCount: number;
  checklistTotal: number;
  checklistComplete: number;
  fixList: ReadinessFixItem[];
};
