// Pure, unit-testable helpers for the Safety Training tracker. No I/O here — the compute
// layer (compute-safety-training.ts) owns the SQL and calls into these.

import type {
  SafetyCategory,
  SafetyCompletion,
  SafetyCompletionStatus,
  SafetyMemberCoverage,
  SafetyModule,
  SafetyTrainingSummary,
} from "./types";

export * from "./types";

export const SAFETY_CATEGORIES: SafetyCategory[] = [
  "shop_general",
  "power_tools",
  "machine_shop",
  "electrical",
  "chemical",
  "ppe",
  "other",
];

const CATEGORY_LABELS: Record<SafetyCategory, string> = {
  shop_general: "Shop General",
  power_tools: "Power Tools",
  machine_shop: "Machine Shop",
  electrical: "Electrical",
  chemical: "Chemical / Hazmat",
  ppe: "PPE",
  other: "Other",
};

export function safetyCategoryLabel(category: SafetyCategory): string {
  return CATEGORY_LABELS[category] ?? category;
}

/** Days before expiry that a completion is flagged "expiring soon". */
export const EXPIRING_SOON_WINDOW_DAYS = 30;

export function completionStatus(
  expiresOn: string | null,
  now: Date = new Date(),
): SafetyCompletionStatus {
  if (!expiresOn) return "current";
  const expiry = new Date(`${expiresOn}T00:00:00Z`);
  const diffDays = Math.floor((expiry.getTime() - now.getTime()) / 86_400_000);
  if (diffDays < 0) return "expired";
  if (diffDays <= EXPIRING_SOON_WINDOW_DAYS) return "expiring_soon";
  return "current";
}

export function expiryDateFor(completedOn: string, validityMonths: number | null): string | null {
  if (!validityMonths || validityMonths <= 0) return null;
  const base = new Date(`${completedOn}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return null;
  base.setUTCMonth(base.getUTCMonth() + validityMonths);
  return base.toISOString().slice(0, 10);
}

/**
 * Builds per-member coverage against the required-module set, and the roll-up summary,
 * from the modules + completions already scoped to an org. Only ever derives from rows
 * actually present — no fabricated members or scores.
 */
export function summarizeSafetyTraining(
  modules: SafetyModule[],
  completions: SafetyCompletion[],
  members: Array<{ id: string; name: string }>,
): { summary: SafetyTrainingSummary; coverage: SafetyMemberCoverage[] } {
  const requiredModules = modules.filter((m) => m.isRequired);

  const byCategory = SAFETY_CATEGORIES.map((category) => ({
    category,
    modules: modules.filter((m) => m.category === category).length,
    completions: completions.filter((c) => c.category === category).length,
  })).filter((row) => row.modules > 0 || row.completions > 0);

  const expiringSoonCount = completions.filter((c) => c.status === "expiring_soon").length;
  const expiredCount = completions.filter((c) => c.status === "expired").length;

  const coverage: SafetyMemberCoverage[] = members.map((member) => {
    const memberCompletions = completions.filter((c) => c.memberId === member.id);
    const currentRequiredIds = new Set(
      memberCompletions
        .filter((c) => c.isRequired && c.status !== "expired")
        .map((c) => c.moduleId),
    );
    const requiredCompleted = requiredModules.filter((m) => currentRequiredIds.has(m.id)).length;
    return {
      memberId: member.id,
      memberName: member.name,
      requiredCompleted,
      requiredTotal: requiredModules.length,
      expiredCount: memberCompletions.filter((c) => c.status === "expired").length,
      expiringSoonCount: memberCompletions.filter((c) => c.status === "expiring_soon").length,
      compliant: requiredModules.length === 0 ? true : requiredCompleted === requiredModules.length,
    };
  });

  const compliantMemberCount = coverage.filter((c) => c.compliant).length;
  const complianceRate = coverage.length > 0 ? compliantMemberCount / coverage.length : 0;

  const summary: SafetyTrainingSummary = {
    totalModules: modules.length,
    requiredModules: requiredModules.length,
    totalCompletions: completions.length,
    memberCount: members.length,
    compliantMemberCount,
    complianceRate: Math.round(complianceRate * 1000) / 1000,
    expiringSoonCount,
    expiredCount,
    byCategory,
  };

  return { summary, coverage };
}
