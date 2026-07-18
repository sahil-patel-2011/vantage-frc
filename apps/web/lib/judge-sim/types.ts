// Judge-pitch simulator domain types. Pure data shapes — no I/O, no framework imports.
// An AI judge asks real FRC judging questions and grades the team's answer against the
// team's own logged evidence (judge_sim_evidence), flagging any claim in the answer that
// isn't backed by anything on record — never inventing evidence that wasn't logged.

export type JudgeSimCategory = "technical" | "strategy" | "teamwork" | "outreach" | "business" | "safety";

/** How well the answer's claims are backed by logged evidence. */
export type JudgeSimVerdict = "well_backed" | "partially_backed" | "unbacked";

export type JudgeSimEvidence = {
  id: string;
  title: string;
  claim: string;
  category: JudgeSimCategory;
  sourceUrl: string | null;
  /** ISO date (YYYY-MM-DD), optional. */
  occurredOn: string | null;
  tags: string[];
  createdAt: string;
};

/** Deterministic grading result, grounded only in the evidence supplied to gradeAnswer(). */
export type JudgeSimGrade = {
  verdict: JudgeSimVerdict;
  confidence: number;
  backedClaims: string[];
  flaggedClaims: string[];
  matchedEvidenceIds: string[];
  feedback: string;
};

export type JudgeSimSession = {
  id: string;
  seasonYear: number;
  category: JudgeSimCategory;
  question: string;
  answerText: string;
  verdict: JudgeSimVerdict;
  confidence: number;
  backedClaims: string[];
  flaggedClaims: string[];
  matchedEvidenceIds: string[];
  feedback: string;
  createdAt: string;
};

export type JudgeSimReadiness = {
  /** 0..1 — share of graded sessions across the season that came back well_backed. */
  score: number;
  totalSessions: number;
  wellBackedCount: number;
  unbackedCount: number;
  evidenceCount: number;
};
