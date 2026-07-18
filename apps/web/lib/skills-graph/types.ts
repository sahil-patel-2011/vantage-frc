// Skills/mentorship graph domain types. Pure data shapes — no I/O, no framework imports.
// Skills are self-declared with an evidence note (never fabricated), and reinforced by
// real completed-task activity in the same category pulled from the Build task board.
// Mentor matching is a deterministic local computation over declared skills + activity —
// no invented scores.

export type SkillCategory =
  | "drivetrain"
  | "intake"
  | "shooter"
  | "arm"
  | "elevator"
  | "climber"
  | "turret"
  | "indexer"
  | "software"
  | "electrical"
  | "mechanical_design"
  | "strategy"
  | "outreach"
  | "other";

export type ProficiencyLevel = "novice" | "developing" | "proficient" | "expert";

export type MentorRequestStatus = "open" | "matched" | "closed";

export type SkillEntry = {
  id: string;
  userId: string;
  userName: string;
  skillCategory: SkillCategory;
  customLabel: string | null;
  proficiency: ProficiencyLevel;
  evidenceNote: string | null;
  taskEvidenceCount: number;
  createdAt: string;
};

export type MentorCandidate = {
  userId: string;
  userName: string;
  proficiency: ProficiencyLevel;
  taskEvidenceCount: number;
  evidenceNote: string | null;
  score: number;
  rationale: string;
};

export type MentorRequest = {
  id: string;
  requesterUserId: string;
  requesterName: string;
  skillCategory: SkillCategory;
  note: string | null;
  status: MentorRequestStatus;
  matchedUserId: string | null;
  matchedUserName: string | null;
  matchedRationale: string | null;
  candidates: MentorCandidate[];
  createdAt: string;
};

export type SkillsGraphSummary = {
  totalEntries: number;
  totalMembers: number;
  totalCategories: number;
  openRequests: number;
  matchedRequests: number;
};
