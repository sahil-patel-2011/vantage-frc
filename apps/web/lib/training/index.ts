// Pure, unit-testable helpers for the Training Matrix. No I/O, no framework imports.

import type {
  CertificationStatus,
  TrainingCategory,
  TrainingCertification,
  TrainingMemberCoverage,
  TrainingSkillCoverage,
  TrainingSummary,
} from "./types";

export const TRAINING_CATEGORY_LABEL: Record<TrainingCategory, string> = {
  mill: "Mill",
  lathe: "Lathe",
  wiring: "Wiring",
  drive: "Drive",
  safety: "Safety",
  software: "Software",
  other: "Other",
};

export function trainingCategoryLabel(category: TrainingCategory): string {
  return TRAINING_CATEGORY_LABEL[category] ?? category;
}

/** Days before expiry that a certification is flagged "expiring soon". */
export const EXPIRING_SOON_WINDOW_DAYS = 30;

/**
 * Derive a certification's status from its expiry date relative to `now`.
 * Certifications with no expiry are always "active".
 */
export function certificationStatus(expiresAt: string | null, now: Date = new Date()): CertificationStatus {
  if (!expiresAt) return "active";
  const expiry = new Date(`${expiresAt}T00:00:00Z`);
  if (Number.isNaN(expiry.getTime())) return "active";
  const nowMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const expiryMs = expiry.getTime();
  if (expiryMs < nowMs) return "expired";
  const daysRemaining = Math.floor((expiryMs - nowMs) / (24 * 60 * 60 * 1000));
  if (daysRemaining <= EXPIRING_SOON_WINDOW_DAYS) return "expiring_soon";
  return "active";
}

/** Given a sign-off date and a skill's validity window, compute the resulting expiry date (ISO), or null. */
export function computeExpiryDate(certifiedAt: string, validityMonths: number | null): string | null {
  if (!validityMonths || validityMonths <= 0) return null;
  const base = new Date(`${certifiedAt}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return null;
  const result = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + validityMonths, base.getUTCDate()));
  return result.toISOString().slice(0, 10);
}

export function summarizeTraining(
  certifications: TrainingCertification[],
  skillCount: number,
): TrainingSummary {
  const bySkillMap = new Map<string, TrainingSkillCoverage>();
  const byMemberMap = new Map<string, TrainingMemberCoverage>();
  const certifiedMembers = new Set<string>();

  let activeCount = 0;
  let expiringSoonCount = 0;
  let expiredCount = 0;

  for (const cert of certifications) {
    certifiedMembers.add(cert.memberUserId);
    if (cert.status === "active") activeCount += 1;
    else if (cert.status === "expiring_soon") expiringSoonCount += 1;
    else expiredCount += 1;

    const skillRow = bySkillMap.get(cert.skillId) ?? {
      skillId: cert.skillId,
      skillName: cert.skillName,
      category: cert.skillCategory,
      activeCount: 0,
      expiringSoonCount: 0,
      expiredCount: 0,
    };
    if (cert.status === "active") skillRow.activeCount += 1;
    else if (cert.status === "expiring_soon") skillRow.expiringSoonCount += 1;
    else skillRow.expiredCount += 1;
    bySkillMap.set(cert.skillId, skillRow);

    const memberRow = byMemberMap.get(cert.memberUserId) ?? {
      memberUserId: cert.memberUserId,
      memberName: cert.memberName,
      activeSkillCount: 0,
      expiringSoonCount: 0,
      expiredCount: 0,
    };
    if (cert.status === "active") memberRow.activeSkillCount += 1;
    else if (cert.status === "expiring_soon") memberRow.expiringSoonCount += 1;
    else memberRow.expiredCount += 1;
    byMemberMap.set(cert.memberUserId, memberRow);
  }

  const bySkill = Array.from(bySkillMap.values()).sort((a, b) => b.activeCount - a.activeCount);
  const byMember = Array.from(byMemberMap.values()).sort((a, b) => b.activeSkillCount - a.activeSkillCount);

  // Coverage signal blends how many of the org's defined skills have at least one active
  // certification (breadth) with the share of certifications that are currently active (freshness).
  const skillsCovered = bySkill.filter((s) => s.activeCount > 0).length;
  const breadth = skillCount > 0 ? skillsCovered / skillCount : 0;
  const freshness = certifications.length > 0 ? activeCount / certifications.length : 0;
  const coverageSignal = Math.max(0, Math.min(1, breadth * 0.6 + freshness * 0.4));

  return {
    totalSkills: skillCount,
    totalCertifications: certifications.length,
    certifiedMemberCount: certifiedMembers.size,
    activeCount,
    expiringSoonCount,
    expiredCount,
    bySkill,
    byMember,
    coverageSignal,
  };
}
