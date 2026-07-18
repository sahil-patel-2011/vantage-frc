// Pure, framework-free mock judging rubric logic. Everything here is deterministic and grounded
// only in the answer text and prep notes the caller supplies — it never invents scores, evidence,
// or feedback that isn't derivable from the inputs. compute-mock-judging.ts wraps this with DB
// I/O; the API route and client render results.

import type {
  MockJudgingAwardCategory,
  MockJudgingCriteriaScores,
  MockJudgingCriterion,
  MockJudgingGrade,
  MockJudgingPrepNote,
} from "./types";

export const MOCK_JUDGING_AWARD_CATEGORIES: MockJudgingAwardCategory[] = [
  "general",
  "chairmans",
  "engineering_inspiration",
  "impact",
  "innovation_in_control",
  "excellence_in_engineering",
  "rookie_all_star",
  "safety",
  "other",
];

export const MOCK_JUDGING_CRITERIA: MockJudgingCriterion[] = [
  "substance",
  "specificity",
  "evidence_grounding",
  "clarity",
  "confidence",
];

export function mockJudgingAwardCategoryLabel(category: MockJudgingAwardCategory): string {
  switch (category) {
    case "chairmans":
      return "Chairman's";
    case "engineering_inspiration":
      return "Engineering Inspiration";
    case "impact":
      return "Impact";
    case "innovation_in_control":
      return "Innovation in Control";
    case "excellence_in_engineering":
      return "Excellence in Engineering";
    case "rookie_all_star":
      return "Rookie All Star";
    case "safety":
      return "Safety";
    case "other":
      return "Other";
    default:
      return "General";
  }
}

export function mockJudgingCriterionLabel(criterion: MockJudgingCriterion): string {
  switch (criterion) {
    case "substance":
      return "Substance";
    case "specificity":
      return "Specificity";
    case "evidence_grounding":
      return "Evidence grounding";
    case "clarity":
      return "Clarity";
    default:
      return "Confidence";
  }
}

/** Real FRC-style judging prompts, grouped by award category. Deterministically rotated. */
export const MOCK_JUDGING_QUESTION_BANK: Record<MockJudgingAwardCategory, string[]> = {
  general: [
    "Tell me about your team in thirty seconds — what makes you memorable?",
    "What is your team most proud of this season?",
    "If you could change one thing about your season, what would it be?",
  ],
  chairmans: [
    "How does your team's mission extend beyond building a robot?",
    "Describe how your team has grown FIRST in your community this year.",
    "What is your team's sustainability plan for the next five years?",
    "How do students lead the vision and direction of your team?",
  ],
  engineering_inspiration: [
    "How has your team inspired other students to pursue STEM?",
    "What STEM education programs has your team run this season, and what was their reach?",
    "How do you measure the impact of your engineering-inspiration efforts?",
  ],
  impact: [
    "Tell me about an outreach event your team ran this season and its measurable impact.",
    "How does your team's outreach reach beyond your own school or community?",
    "What partnerships has your team built to extend your impact?",
  ],
  innovation_in_control: [
    "What is the most innovative control system your team has built, and why?",
    "How did you validate that your control solution actually worked as intended?",
    "What existing approach did your control innovation improve on, and how?",
  ],
  excellence_in_engineering: [
    "Walk me through your engineering design process from problem to solution.",
    "What design decision are you most proud of, and what alternatives did you reject?",
    "How do you document and iterate on your engineering process?",
  ],
  rookie_all_star: [
    "As a rookie team, what has surprised you most about FIRST?",
    "How has your team already started giving back to your community?",
    "What is your team's plan for growth after this first season?",
  ],
  safety: [
    "How does your team train members on shop and competition safety?",
    "Describe your team's safety culture and how it's enforced day to day.",
    "What safety incident changed how your team operates, and what changed?",
  ],
  other: [
    "What sets your team apart from every other team at this competition?",
    "What would you want a judge to remember about your team after this conversation?",
  ],
};

/** Deterministically picks a question for the category using a rotating index (no randomness). */
export function pickMockJudgingQuestion(category: MockJudgingAwardCategory, index: number): string {
  const bank = MOCK_JUDGING_QUESTION_BANK[category];
  const safeIndex = Number.isFinite(index) && index >= 0 ? Math.floor(index) : 0;
  return bank[safeIndex % bank.length]!;
}

const STOPWORDS = new Set([
  "the","a","an","and","or","but","of","to","in","on","at","for","with","is","are","was","were",
  "we","our","us","i","it","this","that","these","those","be","been","being","as","by","from",
  "so","if","then","than","also","its","their","they","he","she","you","your","not","no","do",
  "does","did","have","has","had","will","would","can","could","should","about","into","over",
]);

const HEDGE_WORDS = ["maybe", "probably", "i think", "sort of", "kind of", "i guess", "not sure", "possibly"];

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1 && !STOPWORDS.has(word));
}

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

const clamp05 = (value: number) => Math.min(5, Math.max(0, value));
const round1 = (value: number) => Math.round(value * 10) / 10;

/** Token-overlap ratio between the answer and a prep note's own text. */
export function noteOverlap(answerTokens: Set<string>, note: MockJudgingPrepNote): number {
  const noteTokens = new Set(tokenize(`${note.title} ${note.note} ${note.tags.join(" ")}`));
  if (noteTokens.size === 0 || answerTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of answerTokens) {
    if (noteTokens.has(token)) overlap += 1;
  }
  return overlap / answerTokens.size;
}

/**
 * Rubric-scores an answer for a mock judging round. Grounded only in the answer text and the
 * team's own logged prep notes for the award category — never fabricates evidence or inflates
 * scores beyond what the text and notes support.
 */
export function scoreAnswer(
  answerText: string,
  notes: MockJudgingPrepNote[],
): MockJudgingGrade {
  const trimmed = answerText.trim();
  const words = trimmed.length > 0 ? trimmed.split(/\s+/).filter(Boolean) : [];
  const sentences = splitSentences(trimmed);
  const answerTokens = new Set(tokenize(trimmed));

  if (words.length === 0) {
    const zero: MockJudgingCriteriaScores = {
      substance: 0,
      specificity: 0,
      evidence_grounding: 0,
      clarity: 0,
      confidence: 0,
    };
    return {
      criteriaScores: zero,
      overallScore: 0,
      strengths: [],
      improvements: ["Give an answer to score — an empty response can't be evaluated."],
      feedback: "No answer was given, so nothing could be scored. Try again with a full response.",
    };
  }

  // Substance: word count in a judge-friendly range (too short = thin, too long = rambling).
  const wordCount = words.length;
  const substance = clamp05(
    wordCount < 15
      ? (wordCount / 15) * 3
      : wordCount <= 180
        ? 3 + Math.min(2, (Math.min(wordCount, 120) - 15) / 52.5)
        : Math.max(2, 5 - (wordCount - 180) / 80),
  );

  // Specificity: presence of concrete numbers/data points a judge can probe.
  const numberMatches = trimmed.match(/\b\d[\d,]*(\.\d+)?%?\b/g) ?? [];
  const specificity = clamp05(Math.min(5, numberMatches.length * 1.4 + (numberMatches.length > 0 ? 1 : 0)));

  // Evidence grounding: token overlap with the team's own logged prep notes.
  const overlaps = notes.map((note) => noteOverlap(answerTokens, note));
  const bestOverlap = overlaps.length > 0 ? Math.max(...overlaps) : 0;
  const evidenceGrounding = clamp05(notes.length === 0 ? 1.5 : bestOverlap * 5 + (bestOverlap > 0 ? 1 : 0));

  // Clarity: sentence structure — moderate average sentence length reads as clear, not run-on.
  const avgSentenceLen = sentences.length > 0 ? wordCount / sentences.length : wordCount;
  const clarity = clamp05(
    avgSentenceLen <= 4
      ? 2
      : avgSentenceLen <= 28
        ? 5 - Math.abs(avgSentenceLen - 14) / 14 * 2
        : Math.max(1, 5 - (avgSentenceLen - 28) / 10),
  );

  // Confidence: penalize hedging language.
  const lower = trimmed.toLowerCase();
  const hedgeCount = HEDGE_WORDS.reduce((sum, phrase) => sum + (lower.split(phrase).length - 1), 0);
  const confidence = clamp05(5 - hedgeCount * 1.2);

  const criteriaScores: MockJudgingCriteriaScores = {
    substance: round1(substance),
    specificity: round1(specificity),
    evidence_grounding: round1(evidenceGrounding),
    clarity: round1(clarity),
    confidence: round1(confidence),
  };

  const overallScore = round1(
    (criteriaScores.substance +
      criteriaScores.specificity +
      criteriaScores.evidence_grounding +
      criteriaScores.clarity +
      criteriaScores.confidence) /
      5,
  );

  const entries = Object.entries(criteriaScores) as Array<[MockJudgingCriterion, number]>;
  const strengths = entries
    .filter(([, value]) => value >= 3.8)
    .map(([criterion]) => `Strong ${mockJudgingCriterionLabel(criterion).toLowerCase()}`);
  const improvements = entries
    .filter(([, value]) => value < 2.8)
    .map(([criterion]) => {
      switch (criterion) {
        case "substance":
          return "Add more depth — the answer is too thin or too rambling for a judge to follow.";
        case "specificity":
          return "Add concrete numbers or data points a judge can point back to.";
        case "evidence_grounding":
          return "Ground the answer in something logged in prep notes — judges probe unsupported claims.";
        case "clarity":
          return "Tighten sentence structure — aim for clear, judge-friendly sentence lengths.";
        default:
          return "Cut hedging language ('maybe', 'I think') — answer with confidence.";
      }
    });

  let feedback: string;
  if (overallScore >= 4) {
    feedback = `Overall ${overallScore}/5 — a strong, judge-ready answer. ${strengths.length > 0 ? strengths.join("; ") + "." : ""}`.trim();
  } else if (overallScore >= 2.8) {
    feedback = `Overall ${overallScore}/5 — solid but with room to sharpen. ${improvements.length > 0 ? improvements[0] : ""}`.trim();
  } else {
    feedback = `Overall ${overallScore}/5 — needs real work before this goes in front of a judge. ${improvements.length > 0 ? improvements[0] : ""}`.trim();
  }

  return { criteriaScores, overallScore, strengths, improvements, feedback };
}
