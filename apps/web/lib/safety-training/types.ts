// Safety training domain types. Pure data shapes — no I/O, no framework imports.
// Tracks shop-safety training modules (power tools, machine shop, electrical, chemical, PPE)
// and the per-member completion/certification record that proves who is currently cleared.

export type SafetyCategory =
  | "shop_general"
  | "power_tools"
  | "machine_shop"
  | "electrical"
  | "chemical"
  | "ppe"
  | "other";

export type SafetyModule = {
  id: string;
  title: string;
  category: SafetyCategory;
  description: string | null;
  isRequired: boolean;
  /** Certification validity window in months, or null if it never expires. */
  validityMonths: number | null;
  createdAt: string;
};

export type SafetyCompletionStatus = "current" | "expiring_soon" | "expired";

export type SafetyCompletion = {
  id: string;
  moduleId: string;
  moduleTitle: string;
  category: SafetyCategory;
  isRequired: boolean;
  memberId: string;
  memberName: string;
  completedOn: string;
  expiresOn: string | null;
  certificateUrl: string | null;
  notes: string | null;
  status: SafetyCompletionStatus;
};

export type SafetyMemberCoverage = {
  memberId: string;
  memberName: string;
  requiredCompleted: number;
  requiredTotal: number;
  expiredCount: number;
  expiringSoonCount: number;
  compliant: boolean;
};

export type SafetyTrainingSummary = {
  totalModules: number;
  requiredModules: number;
  totalCompletions: number;
  memberCount: number;
  compliantMemberCount: number;
  /** 0..1 share of members current on every required module. */
  complianceRate: number;
  expiringSoonCount: number;
  expiredCount: number;
  byCategory: Array<{ category: SafetyCategory; modules: number; completions: number }>;
};
