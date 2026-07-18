// Sketch-to-Brief domain types. Pure data shapes — no I/O, no framework imports.
// A whiteboard-kickoff-sketch (transcribed to text notes: mechanism intent,
// labels, rough dimensions) is turned into a grounded first-pass CAD brief plus
// a rule-compliance check, cross-referenced against the org's own kickoff rule
// notes and design priorities — never invented rule text.

export type MechanismCategory =
  | "intake"
  | "shooter"
  | "climb"
  | "drivetrain"
  | "manipulator"
  | "other";

export type SketchStatus = "draft" | "brief_ready";

export type SketchRecord = {
  id: string;
  title: string;
  notes: string;
  category: MechanismCategory;
  status: SketchStatus;
  seasonYear: number;
  createdAt: string;
};

export type RuleFlagSeverity = "info" | "caution" | "blocker";

export type RuleFlag = {
  severity: RuleFlagSeverity;
  summary: string;
  /** Rule manual section/number when grounded in an org kickoff rule note; null for a generic engineering caution. */
  ruleRef: string | null;
  /** kickoff_rule_notes.id this flag was grounded in, when applicable. */
  sourceNoteId: string | null;
};

export type BriefSection = {
  heading: string;
  bullets: string[];
};

export type CadBriefDraft = {
  mechanismIntent: string;
  category: MechanismCategory;
  sections: BriefSection[];
  ruleFlags: RuleFlag[];
  /** IDs of the sketch, rule notes, design priorities, and scoring actions the draft drew on. */
  sourceRefs: string[];
};

export type BriefRecord = {
  id: string;
  sketchId: string;
  sketchTitle: string;
  title: string;
  brief: CadBriefDraft;
  generatedBy: "ai" | "local";
  createdAt: string;
};

export type SketchToBriefSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type SketchToBriefView =
  | {
      status: "setup_required";
      message: string;
      steps: SketchToBriefSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      sketches: SketchRecord[];
      briefs: BriefRecord[];
      computedAt: string;
    };
