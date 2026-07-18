// Training Matrix domain types. Pure data shapes — no I/O, no framework imports.
// Tracks who is certified/trained on shop and drive-team skills (mill, lathe, wiring, drive,
// safety, …) with a sign-off (who certified, when) and an optional expiry.

export type TrainingCategory = "mill" | "lathe" | "wiring" | "drive" | "safety" | "software" | "other";

export type TrainingSkill = {
  id: string;
  name: string;
  category: TrainingCategory;
  description: string | null;
  /** Months a certification for this skill stays valid before it must be renewed; null = never expires. */
  validityMonths: number | null;
  createdAt: string;
};

export type CertificationStatus = "active" | "expiring_soon" | "expired";

export type TrainingCertification = {
  id: string;
  skillId: string;
  skillName: string;
  skillCategory: TrainingCategory;
  memberUserId: string;
  memberName: string;
  memberEmail: string;
  certifiedByUserId: string;
  certifiedByName: string;
  /** ISO date (YYYY-MM-DD). */
  certifiedAt: string;
  /** ISO date (YYYY-MM-DD) or null if the certification never expires. */
  expiresAt: string | null;
  notes: string | null;
  status: CertificationStatus;
};

export type TrainingSkillCoverage = {
  skillId: string;
  skillName: string;
  category: TrainingCategory;
  activeCount: number;
  expiringSoonCount: number;
  expiredCount: number;
};

export type TrainingMemberCoverage = {
  memberUserId: string;
  memberName: string;
  activeSkillCount: number;
  expiringSoonCount: number;
  expiredCount: number;
};

export type TrainingSummary = {
  totalSkills: number;
  totalCertifications: number;
  certifiedMemberCount: number;
  activeCount: number;
  expiringSoonCount: number;
  expiredCount: number;
  bySkill: TrainingSkillCoverage[];
  byMember: TrainingMemberCoverage[];
  /** 0..1 signal blending skill coverage breadth with certification freshness. */
  coverageSignal: number;
};
