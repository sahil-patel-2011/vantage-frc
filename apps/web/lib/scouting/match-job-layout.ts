import { isLayoutOnlyField, type FieldDefinition } from "@vantage/scouting";
import { inferPhaseFromKey, type InferredPhase } from "./context-visible";

/**
 * Collection-class match job: Auto → Teleop → Endgame → this-match extras → Notes.
 * Groups published fields by key/label. Does not invent answers or clone a game screen.
 */

export type MatchJobPhase = "auto" | "teleop" | "endgame" | "other" | "notes";

export const MATCH_JOB_PHASE_ORDER: readonly MatchJobPhase[] = [
  "auto",
  "teleop",
  "endgame",
  "other",
  "notes",
];

export type MatchJobPhaseCopy = {
  title: string;
  purpose: string;
};

export const MATCH_JOB_PHASE_COPY: Record<MatchJobPhase, MatchJobPhaseCopy> = {
  auto: {
    title: "Auto",
    purpose: "What this robot did in the autonomous period.",
  },
  teleop: {
    title: "Teleop",
    purpose: "Scoring, feeding, and defense after auto.",
  },
  endgame: {
    title: "Endgame",
    purpose: "Climb or tower — only what you saw this match.",
  },
  other: {
    title: "This match",
    purpose: "Other facts from this match that are not auto, teleop, or climb.",
  },
  notes: {
    title: "Notes",
    purpose: "Short extras the counts do not already capture. Leave blank if nothing to add.",
  },
};

export type MatchJobSection<T> = {
  phase: MatchJobPhase;
  title: string;
  purpose: string;
  fields: T[];
};

const NOTES_KEY = /^(notes?|comments?|remarks?|qualitative)$/i;

export function isMatchJobStageField(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return normalized === "gamephase" || normalized === "phase";
}

export function isMatchJobNotesField(key: string, label?: string): boolean {
  if (NOTES_KEY.test(key.trim())) return true;
  if (label && NOTES_KEY.test(label.trim())) return true;
  return false;
}

function inferredToJobPhase(phase: InferredPhase): MatchJobPhase {
  switch (phase) {
    case "auto":
      return "auto";
    case "teleop":
    case "defense":
      return "teleop";
    case "endgame":
    case "climb":
      return "endgame";
    default: {
      const _exhaustive: never = phase;
      throw new Error(`Unhandled match phase: ${_exhaustive}`);
    }
  }
}

function phaseFromHeaderLabel(label: string): MatchJobPhase | null {
  const normalized = label.replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (!normalized) return null;
  if (normalized.includes("note") || normalized.includes("comment")) return "notes";
  if (normalized.includes("endgame") || normalized.includes("climb") || normalized.includes("tower")) {
    return "endgame";
  }
  if (normalized.includes("tele")) return "teleop";
  if (normalized.includes("auto") || normalized.includes("auton") || normalized.includes("prematch")) {
    return "auto";
  }
  return null;
}

export function classifyMatchJobPhase(
  field: Pick<FieldDefinition, "key" | "type" | "label">,
): MatchJobPhase | null {
  if (isLayoutOnlyField(field) || isMatchJobStageField(field.key)) return null;
  if (isMatchJobNotesField(field.key, field.label)) return "notes";
  const fromKey = inferPhaseFromKey(field.key);
  if (fromKey) return inferredToJobPhase(fromKey);
  const fromLabel = inferPhaseFromKey(field.label.replace(/[^a-z0-9]+/gi, "_"));
  if (fromLabel) return inferredToJobPhase(fromLabel);
  return "other";
}

function copyForPhase(phase: MatchJobPhase, titleOverride?: string): MatchJobPhaseCopy {
  const copy = MATCH_JOB_PHASE_COPY[phase];
  if (titleOverride && titleOverride.trim()) {
    return { title: titleOverride.trim(), purpose: copy.purpose };
  }
  return copy;
}

/**
 * Order answer fields Auto → Teleop → Endgame → this match → Notes.
 * Author section headers keep their labels; fields still sort into that Saturday order.
 */
export function layoutMatchJobFields<T extends Pick<FieldDefinition, "key" | "type" | "label">>(
  fields: readonly T[],
): MatchJobSection<T>[] {
  const buckets: Record<MatchJobPhase, T[]> = {
    auto: [],
    teleop: [],
    endgame: [],
    other: [],
    notes: [],
  };
  const headerTitle: Partial<Record<MatchJobPhase, string>> = {};
  let headerPhase: MatchJobPhase | null = null;

  for (const field of fields) {
    if (isLayoutOnlyField(field)) {
      headerPhase = phaseFromHeaderLabel(field.label) ?? "other";
      headerTitle[headerPhase] = field.label;
      continue;
    }
    const classified = classifyMatchJobPhase(field);
    if (classified == null) continue;
    const phase = headerPhase && classified === "other" ? headerPhase : classified;
    buckets[phase].push(field);
  }

  const sections: MatchJobSection<T>[] = [];
  for (const phase of MATCH_JOB_PHASE_ORDER) {
    const grouped = buckets[phase];
    if (!grouped.length) continue;
    const copy = copyForPhase(phase, headerTitle[phase]);
    sections.push({
      phase,
      title: copy.title,
      purpose: copy.purpose,
      fields: grouped,
    });
  }
  return sections;
}

export const PIT_JOB_COPY = {
  robot: {
    title: "Robot",
    purpose: "What you can confirm in the pit — drivetrain, language, photos. Not a scoring claim.",
  },
  notes: MATCH_JOB_PHASE_COPY.notes,
} as const;

export type PitJobSection<T> = {
  id: "robot" | "notes";
  title: string;
  purpose: string;
  fields: T[];
};

/** Pit form: robot facts first, notes last. */
export function layoutPitJobFields<T extends Pick<FieldDefinition, "key" | "type" | "label">>(
  fields: readonly T[],
): PitJobSection<T>[] {
  const robot: T[] = [];
  const notes: T[] = [];
  for (const field of fields) {
    if (isLayoutOnlyField(field) || isMatchJobStageField(field.key)) continue;
    if (isMatchJobNotesField(field.key, field.label)) notes.push(field);
    else robot.push(field);
  }
  const sections: PitJobSection<T>[] = [];
  if (robot.length) {
    sections.push({ id: "robot", title: PIT_JOB_COPY.robot.title, purpose: PIT_JOB_COPY.robot.purpose, fields: robot });
  }
  if (notes.length) {
    sections.push({ id: "notes", title: PIT_JOB_COPY.notes.title, purpose: PIT_JOB_COPY.notes.purpose, fields: notes });
  }
  return sections;
}
