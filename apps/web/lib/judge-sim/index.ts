// Pure, framework-free judge-pitch simulator logic. Everything here is deterministic and
// grounded only in the evidence the caller supplies — it never invents evidence or claims.
// compute-judge-sim.ts wraps this with DB I/O; the API route and client render results.

import type { JudgeSimCategory, JudgeSimEvidence, JudgeSimGrade, JudgeSimVerdict } from "./types";

export const JUDGE_SIM_CATEGORIES: JudgeSimCategory[] = [
  "technical",
  "strategy",
  "teamwork",
  "outreach",
  "business",
  "safety",
];

/** A claim is graded "backed" once the token overlap with some evidence item reaches this ratio. */
export const CLAIM_MATCH_THRESHOLD = 0.34;
/** Minimum word count for a sentence to be treated as a checkable claim (short filler is skipped). */
export const MIN_CLAIM_WORDS = 4;

export function judgeSimCategoryLabel(category: JudgeSimCategory): string {
  switch (category) {
    case "technical":
      return "Technical";
    case "strategy":
      return "Strategy";
    case "teamwork":
      return "Teamwork";
    case "outreach":
      return "Outreach";
    case "business":
      return "Business";
    default:
      return "Safety";
  }
}

export function judgeSimVerdictLabel(verdict: JudgeSimVerdict): string {
  switch (verdict) {
    case "well_backed":
      return "Well backed";
    case "partially_backed":
      return "Partially backed";
    default:
      return "Unbacked";
  }
}

/** Real FRC judging-style questions, grouped by category. Deterministically rotated per session. */
export const JUDGE_QUESTION_BANK: Record<JudgeSimCategory, string[]> = {
  technical: [
    "Walk me through a design decision your team made and why you chose that solution over the alternatives.",
    "What is the biggest technical challenge your team faced this build season, and how did you solve it?",
    "How does your robot's design address this year's game strategy?",
    "What testing did you do before competition to validate your design choices?",
    "Describe a mechanism on your robot that failed during testing. What did you learn?",
  ],
  strategy: [
    "How does your team decide which alliance partners to pick, and what data drives that decision?",
    "What is your team's scouting process, and how does it inform your match strategy?",
    "How did your strategy evolve over the course of the season?",
    "What trade-offs did you consider between offense and defense in your robot's design?",
  ],
  teamwork: [
    "How is your team organized, and how do students take ownership of subsystems?",
    "Describe a conflict your team faced this season and how you resolved it.",
    "How do you train new members and pass down knowledge each year?",
    "What role do mentors play on your team, and how do students lead?",
  ],
  outreach: [
    "Tell me about an outreach event your team ran this season and its impact.",
    "How does your team measure the impact of your community outreach?",
    "How do you engage younger students or other FRC teams in your community?",
    "What sustainability practices has your team adopted?",
  ],
  business: [
    "How does your team fund its season, and what is your sponsorship strategy?",
    "What is your team's budget for this season, and how do you allocate it?",
    "How do you build and maintain relationships with sponsors?",
    "What is your team's plan for long-term sustainability?",
  ],
  safety: [
    "How does your team train members on shop and competition safety?",
    "Describe your team's safety culture and how it's enforced.",
    "What safety incidents has your team had, and what changed as a result?",
  ],
};

/** Deterministically picks a question for the category using a rotating index (no randomness). */
export function pickJudgeQuestion(category: JudgeSimCategory, index: number): string {
  const bank = JUDGE_QUESTION_BANK[category];
  const safeIndex = Number.isFinite(index) && index >= 0 ? Math.floor(index) : 0;
  return bank[safeIndex % bank.length]!;
}

const STOPWORDS = new Set([
  "the","a","an","and","or","but","of","to","in","on","at","for","with","is","are","was","were",
  "we","our","us","i","it","this","that","these","those","be","been","being","as","by","from",
  "so","if","then","than","also","its","their","they","he","she","you","your","not","no","do",
  "does","did","have","has","had","will","would","can","could","should","about","into","over",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1 && !STOPWORDS.has(word));
}

/** Splits an answer into sentence-like claims worth checking against evidence. */
export function extractClaims(answer: string): string[] {
  return answer
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0 && tokenize(sentence).length >= MIN_CLAIM_WORDS);
}

/** Token-overlap ratio (relative to the claim's own token count) between a claim and an evidence item. */
export function claimEvidenceOverlap(claim: string, evidence: JudgeSimEvidence): number {
  const claimTokens = new Set(tokenize(claim));
  if (claimTokens.size === 0) return 0;
  const evidenceTokens = new Set(tokenize(`${evidence.title} ${evidence.claim} ${evidence.tags.join(" ")}`));
  if (evidenceTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of claimTokens) {
    if (evidenceTokens.has(token)) overlap += 1;
  }
  return overlap / claimTokens.size;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const round = (value: number, places = 3) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

/**
 * Grades an answer against the team's own logged evidence. Every claim (sentence) in the answer
 * is checked for token overlap against each evidence item; claims with no sufficiently overlapping
 * evidence are flagged as unbackable. Grounded only in the supplied evidence — never fabricated.
 */
export function gradeAnswer(answer: string, evidence: JudgeSimEvidence[]): JudgeSimGrade {
  const claims = extractClaims(answer);

  if (claims.length === 0) {
    return {
      verdict: "unbacked",
      confidence: 0.3,
      backedClaims: [],
      flaggedClaims: [],
      matchedEvidenceIds: [],
      feedback:
        "No specific, checkable claims were detected in this answer. Judges respond to concrete evidence — add specifics (numbers, events, outcomes) backed by what you've logged.",
    };
  }

  const backedClaims: string[] = [];
  const flaggedClaims: string[] = [];
  const matchedEvidenceIds = new Set<string>();

  for (const claim of claims) {
    let bestScore = 0;
    let bestEvidenceId: string | null = null;
    for (const item of evidence) {
      const score = claimEvidenceOverlap(claim, item);
      if (score > bestScore) {
        bestScore = score;
        bestEvidenceId = item.id;
      }
    }
    if (bestScore >= CLAIM_MATCH_THRESHOLD && bestEvidenceId) {
      backedClaims.push(claim);
      matchedEvidenceIds.add(bestEvidenceId);
    } else {
      flaggedClaims.push(claim);
    }
  }

  const ratio = backedClaims.length / claims.length;
  const verdict: JudgeSimVerdict = ratio >= 0.66 ? "well_backed" : ratio > 0 ? "partially_backed" : "unbacked";
  const confidence = round(clamp01(0.3 + ratio * 0.6 + (evidence.length > 0 ? 0.1 : 0)));

  let feedback: string;
  if (verdict === "well_backed") {
    feedback = `${backedClaims.length}/${claims.length} claims are backed by logged evidence. Strong answer — keep citing specifics like this in front of judges.`;
  } else if (verdict === "partially_backed") {
    feedback = `${backedClaims.length}/${claims.length} claims are backed by logged evidence. ${flaggedClaims.length} claim(s) below have nothing on record to back them up — log the evidence or drop the claim before you say it to a judge.`;
  } else {
    feedback =
      evidence.length === 0
        ? "No evidence is logged yet for this org, so none of these claims can be backed. Log evidence first, then re-run this answer."
        : `None of the ${claims.length} claim(s) in this answer matched logged evidence. Judges will probe unbacked claims — either log the supporting evidence or rework the answer.`;
  }

  return {
    verdict,
    confidence,
    backedClaims,
    flaggedClaims,
    matchedEvidenceIds: Array.from(matchedEvidenceIds),
    feedback,
  };
}
