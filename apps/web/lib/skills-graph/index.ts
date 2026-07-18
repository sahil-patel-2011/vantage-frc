// Pure, framework-free skills-graph math. Everything here is deterministic and grounded only
// in the declared skill entries and real completed-task counts the caller supplies — it never
// fabricates a value. compute-skills-graph.ts wraps this with DB I/O; the API route and client
// render results.

import type { MentorCandidate, ProficiencyLevel, SkillCategory } from "./types";

export const SKILL_CATEGORIES: SkillCategory[] = [
  "drivetrain",
  "intake",
  "shooter",
  "arm",
  "elevator",
  "climber",
  "turret",
  "indexer",
  "software",
  "electrical",
  "mechanical_design",
  "strategy",
  "outreach",
  "other",
];

export const PROFICIENCY_LEVELS: ProficiencyLevel[] = ["novice", "developing", "proficient", "expert"];

const PROFICIENCY_WEIGHT: Record<ProficiencyLevel, number> = {
  novice: 0.15,
  developing: 0.4,
  proficient: 0.7,
  expert: 1,
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const round = (value: number, places = 3) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

export function skillCategoryLabel(category: SkillCategory): string {
  if (category === "other") return "Other";
  if (category === "mechanical_design") return "Mechanical design";
  return category.charAt(0).toUpperCase() + category.slice(1);
}

export function proficiencyLabel(level: ProficiencyLevel): string {
  return level.charAt(0).toUpperCase() + level.slice(1);
}

export function proficiencyWeight(level: ProficiencyLevel): number {
  return PROFICIENCY_WEIGHT[level];
}

export type MentorCandidateInput = {
  userId: string;
  userName: string;
  proficiency: ProficiencyLevel;
  taskEvidenceCount: number;
  evidenceNote: string | null;
};

/**
 * Rank potential mentors for a requester on a given skill category. Blends the declared
 * proficiency (self-reported) with real completed-task evidence in the same category
 * (from the Build task board), so a bare self-claim without any track record scores lower
 * than one backed by shipped work. Never invents a score for a candidate with no data.
 */
export function rankMentorCandidates(
  candidates: MentorCandidateInput[],
  excludeUserId: string,
): MentorCandidate[] {
  const maxEvidence = Math.max(1, ...candidates.map((c) => c.taskEvidenceCount));
  return candidates
    .filter((c) => c.userId !== excludeUserId)
    .map((c) => {
      const proficiencyScore = proficiencyWeight(c.proficiency);
      const evidenceScore = clamp01(c.taskEvidenceCount / maxEvidence);
      const score = round(clamp01(proficiencyScore * 0.65 + evidenceScore * 0.35));
      const parts: string[] = [`declared ${proficiencyLabel(c.proficiency).toLowerCase()}`];
      if (c.taskEvidenceCount > 0) {
        parts.push(`${c.taskEvidenceCount} completed task(s) logged in this category`);
      } else {
        parts.push("no completed-task evidence yet");
      }
      return {
        userId: c.userId,
        userName: c.userName,
        proficiency: c.proficiency,
        taskEvidenceCount: c.taskEvidenceCount,
        evidenceNote: c.evidenceNote,
        score,
        rationale: parts.join("; "),
      };
    })
    .sort((a, b) => b.score - a.score || b.taskEvidenceCount - a.taskEvidenceCount);
}
