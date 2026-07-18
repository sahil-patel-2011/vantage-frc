// Sketch-to-Brief pure helpers — no I/O, unit-testable. compute-sketch-to-brief.ts
// loads the raw rows from Postgres and hands them to these functions.

import type {
  BriefSection,
  CadBriefDraft,
  MechanismCategory,
  RuleFlag,
} from "./types";

export const MECHANISM_CATEGORIES: MechanismCategory[] = [
  "intake",
  "shooter",
  "climb",
  "drivetrain",
  "manipulator",
  "other",
];

const CATEGORY_KEYWORDS: Record<Exclude<MechanismCategory, "other">, string[]> = {
  intake: ["intake", "collect", "pickup", "pick up", "hopper", "feeder"],
  shooter: ["shoot", "shooter", "flywheel", "launch", "turret", "hood"],
  climb: ["climb", "climber", "hang", "cage", "ascent", "lift"],
  drivetrain: ["drivetrain", "chassis", "swerve", "tank drive", "wheel base", "drive base"],
  manipulator: ["arm", "gripper", "claw", "wrist", "pivot arm", "end effector"],
};

export function mechanismCategoryLabel(category: MechanismCategory): string {
  switch (category) {
    case "intake":
      return "Intake";
    case "shooter":
      return "Shooter";
    case "climb":
      return "Climb";
    case "drivetrain":
      return "Drivetrain";
    case "manipulator":
      return "Manipulator";
    default:
      return "Other";
  }
}

/** Deterministic keyword scan of the transcribed sketch notes — never invents a category. */
export function detectMechanismCategory(notes: string): MechanismCategory {
  const lower = notes.toLowerCase();
  for (const category of Object.keys(CATEGORY_KEYWORDS) as Array<Exclude<MechanismCategory, "other">>) {
    if (CATEGORY_KEYWORDS[category].some((keyword) => lower.includes(keyword))) {
      return category;
    }
  }
  return "other";
}

const DIMENSION_PATTERN = /\d+(\.\d+)?\s*(in|inch|inches|"|mm|cm|ft|feet|lb|lbs)\b/i;

/** Lines from the transcribed notes that carry a measurement — the only "dimensions" a brief may cite. */
export function extractDimensionNotes(notes: string): string[] {
  return notes
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && DIMENSION_PATTERN.test(line))
    .slice(0, 12);
}

const GENERIC_RULE_TRIGGERS: Array<{ pattern: RegExp; summary: string }> = [
  {
    pattern: /extend|expand|telescop|outside.{0,10}frame/i,
    summary:
      "Notes mention extending beyond the frame — confirm the mechanism stays within the season's extension/frame-perimeter rules before committing to CAD.",
  },
  {
    pattern: /motor|gearbox|falcon|neo|kraken/i,
    summary: "Notes reference motor selection — confirm against the season's motor-count and power-budget rules.",
  },
  {
    pattern: /pneumatic|cylinder|solenoid/i,
    summary: "Notes reference pneumatics — confirm cylinder/tank rules and pressure limits for the season.",
  },
];

export type RuleNoteRow = { id: string; question: string; answer: string; ruleRef: string };

/**
 * Cross-references the sketch notes against the org's own answered kickoff rule
 * notes (real data — never fabricated rule text) plus a small set of generic
 * engineering cautions triggered by note content. Grounded flags always carry a
 * sourceNoteId; generic cautions carry neither ruleRef nor sourceNoteId.
 */
export function matchRuleFlags(notes: string, answeredRuleNotes: RuleNoteRow[]): RuleFlag[] {
  const lower = notes.toLowerCase();
  const flags: RuleFlag[] = [];

  for (const note of answeredRuleNotes) {
    const questionWords = note.question
      .toLowerCase()
      .split(/\W+/)
      .filter((word) => word.length > 4);
    const overlap = questionWords.filter((word) => lower.includes(word));
    if (overlap.length >= 2) {
      flags.push({
        severity: "caution",
        summary: `Sketch touches a rule your team already logged: "${note.question}" — ${note.answer}`.slice(0, 320),
        ruleRef: note.ruleRef || null,
        sourceNoteId: note.id,
      });
    }
  }

  for (const trigger of GENERIC_RULE_TRIGGERS) {
    if (trigger.pattern.test(notes)) {
      flags.push({ severity: "info", summary: trigger.summary, ruleRef: null, sourceNoteId: null });
    }
  }

  return flags.slice(0, 10);
}

export type DesignPriorityRow = { id: string; capability: string; rationale: string };
export type OpenRuleQuestionRow = { id: string; question: string };
export type ScoringActionRow = { id: string; label: string; phase: string; points: number };

/**
 * Deterministically composes a first-pass CAD brief from the transcribed sketch
 * notes plus whatever real grounding data the org already has on file (kickoff
 * rule notes, design priorities, scoring actions). Pure — no I/O — so identical
 * inputs always produce identical output.
 */
export function composeCadBriefDraft(input: {
  sketchId: string;
  notes: string;
  category: MechanismCategory;
  answeredRuleNotes: RuleNoteRow[];
  openRuleQuestions: OpenRuleQuestionRow[];
  designPriorities: DesignPriorityRow[];
  scoringActions: ScoringActionRow[];
}): CadBriefDraft {
  const dimensionNotes = extractDimensionNotes(input.notes);
  const ruleFlags = matchRuleFlags(input.notes, input.answeredRuleNotes);
  const sourceRefs: string[] = [input.sketchId];

  const sections: BriefSection[] = [];

  const firstLine = input.notes.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim();
  sections.push({
    heading: "Mechanism intent",
    bullets: [
      firstLine
        ? `${mechanismCategoryLabel(input.category)} concept: ${firstLine}`.slice(0, 280)
        : `${mechanismCategoryLabel(input.category)} concept sketched at kickoff — see transcribed notes for detail.`,
    ],
  });

  if (dimensionNotes.length) {
    sections.push({ heading: "Dimensions called out on the sketch", bullets: dimensionNotes });
  }

  const relatedPriorities = input.designPriorities.filter((priority) =>
    input.notes.toLowerCase().includes(priority.capability.toLowerCase().slice(0, 12)),
  );
  if (relatedPriorities.length) {
    sections.push({
      heading: "Linked design priorities",
      bullets: relatedPriorities.map((priority) => {
        sourceRefs.push(priority.id);
        return `${priority.capability}${priority.rationale ? ` — ${priority.rationale}` : ""}`.slice(0, 220);
      }),
    });
  }

  const relatedActions = input.scoringActions.slice(0, 5);
  if (relatedActions.length) {
    sections.push({
      heading: "Scoring actions this mechanism could serve",
      bullets: relatedActions.map((action) => {
        sourceRefs.push(action.id);
        return `${action.label} (${action.phase}, ${action.points} pts)`;
      }),
    });
  }

  if (input.openRuleQuestions.length) {
    sections.push({
      heading: "Open rules questions to resolve before build",
      bullets: input.openRuleQuestions.slice(0, 3).map((question) => {
        sourceRefs.push(question.id);
        return question.question;
      }),
    });
  }

  for (const flag of ruleFlags) {
    if (flag.sourceNoteId) sourceRefs.push(flag.sourceNoteId);
  }

  return {
    mechanismIntent: firstLine ?? `${mechanismCategoryLabel(input.category)} mechanism from kickoff sketch`,
    category: input.category,
    sections,
    ruleFlags,
    sourceRefs: Array.from(new Set(sourceRefs)),
  };
}
