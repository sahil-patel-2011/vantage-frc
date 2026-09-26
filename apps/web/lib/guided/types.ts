/**
 * Guided tracks: step-by-step lessons where each step is checked before it counts.
 *
 * A step says what to do, then how Vantage checks it. The check is real or it is not offered:
 * an Onshape step reads the student's own Part Studio through the Onshape API, a code step reads
 * what they paste for the lines a working build prints, a GitHub step asks GitHub whether the pull
 * request or tag exists. Where software cannot tell (a mentor watched you use the band saw), the
 * step says a lead signs it off, and only a lead can.
 */

export type FeatureExpectation = {
  /** Onshape featureType, e.g. "newSketch", "extrude", "fillet", "hole", "assignVariable". */
  featureType: string;
  /** At least this many, not suppressed. Defaults to 1. */
  min?: number;
  /** Plain words for the result line: "a sketch", "an extrude". */
  label: string;
};

export type StepCheck =
  /** Reads the Part Studio at the pasted Onshape URL and counts features. */
  | { kind: "onshape-features"; expect: FeatureExpectation[]; anyOf?: false }
  /** Passes when at least one of the expectations is met (e.g. a hole OR a second extrude). */
  | { kind: "onshape-features"; expect: FeatureExpectation[]; anyOf: true }
  /** The part has a material and a mass (Onshape mass properties). */
  | { kind: "onshape-mass" }
  /** Onshape is connected for this account. */
  | { kind: "onshape-connected" }
  /** Pasted text must contain every pattern (a build log, a config block). */
  | { kind: "paste"; prompt: string; must: Array<{ pattern: string; flags?: string; missing: string }> }
  /** Two or more numbers compared against a tolerance. */
  | {
      kind: "numbers";
      fields: Array<{ id: string; label: string; unit: string }>;
      /** Passes when |a - b| <= tolerance for the named pair. */
      within: { a: string; b: string; tolerance: number; unit: string };
    }
  /** A GitHub pull request URL that exists; optionally with discussion on it. */
  | { kind: "github-pr"; minComments?: number }
  /** A GitHub tag or release URL that exists. */
  | { kind: "github-tag" }
  /** Software cannot tell: a team lead signs the step off. */
  | { kind: "lead-signoff"; what: string };

export type GuidedStep = {
  id: string;
  title: string;
  /** Why this step matters, one or two sentences. */
  why?: string;
  /** What to do, in order. */
  do: string[];
  /** How it is checked, in words the student reads before trying. */
  checkedBy: string;
  check: StepCheck;
  links?: Array<{ label: string; href: string }>;
};

export type GuidedTrack = {
  id: string;
  title: string;
  summary: string;
  /** Rough time, e.g. "About 2 hours". */
  time: string;
  audience: string;
  steps: GuidedStep[];
};

export type CheckResult = {
  passed: boolean;
  /** One plain sentence: what was found, or what is missing. */
  message: string;
  /** What was read, for "How this was checked". */
  evidence?: string[];
};

/** Progress rows use this lesson-id prefix in cad_learn_progress, apart from the CAD track. */
export const GUIDED_PREFIX = "guided:";

export function guidedLessonId(trackId: string, stepId: string): string {
  return `${GUIDED_PREFIX}${trackId}:${stepId}`;
}
