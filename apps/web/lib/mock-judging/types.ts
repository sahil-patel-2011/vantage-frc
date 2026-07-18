// Mock Judging domain types. Pure data shapes — no I/O, no framework imports.
// An AI judge runs a full mock judging round per award category and rubric-scores the answer
// (0-5 per criterion), grounding feedback in the team's own logged prep notes — never inventing
// evidence or scores the answer/notes don't support.

export type MockJudgingAwardCategory =
  | "general"
  | "chairmans"
  | "engineering_inspiration"
  | "impact"
  | "innovation_in_control"
  | "excellence_in_engineering"
  | "rookie_all_star"
  | "safety"
  | "other";

/** Rubric dimensions an AI judge scores every answer against, 0-5 each. */
export type MockJudgingCriterion =
  | "substance"
  | "specificity"
  | "evidence_grounding"
  | "clarity"
  | "confidence";

export type MockJudgingPrepNote = {
  id: string;
  title: string;
  note: string;
  awardCategory: MockJudgingAwardCategory;
  tags: string[];
  createdAt: string;
};

export type MockJudgingCriteriaScores = Record<MockJudgingCriterion, number>;

/** Deterministic rubric-grading result, grounded only in the answer and prep notes supplied. */
export type MockJudgingGrade = {
  criteriaScores: MockJudgingCriteriaScores;
  overallScore: number;
  strengths: string[];
  improvements: string[];
  feedback: string;
};

export type MockJudgingSession = {
  id: string;
  seasonYear: number;
  awardCategory: MockJudgingAwardCategory;
  question: string;
  answerText: string;
  criteriaScores: MockJudgingCriteriaScores;
  overallScore: number;
  strengths: string[];
  improvements: string[];
  feedback: string;
  createdAt: string;
};

export type MockJudgingReadiness = {
  /** 0..1 — mean overall rubric score across the season's sessions, normalized. */
  score: number;
  totalSessions: number;
  strongSessionCount: number;
  weakSessionCount: number;
  categoriesCovered: number;
  notesCount: number;
};
