import type { BuildRelatedId } from "../build/build-related";
import { hubHref } from "../nav/hubs";
import type { DecisionRecommendation, DecisionStatus, TestOutcome } from "./types";

/** Focused Soft-UI Build strip when Prototypes is open (never DEMO placeholders). */
export const PROTOTYPE_BUILD_RELATED_INCLUDE: BuildRelatedId[] = [
  "fmea",
  "cad",
  "kickoff",
];

export type PrototypeNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

/**
 * Readable Soft-UI next actions for the prototype tracker.
 * Points at real test logging + FMEA / CAD / Kickoff — never DEMO metrics.
 */
export function prototypeNextActions(input: {
  orgId?: string | null;
  seasonYear: number;
  testCount: number;
  decisionCount: number;
  draftDecisionCount: number;
  testsWithoutDecision: number;
}): PrototypeNextAction[] {
  const orgId = input.orgId ?? null;

  if (!orgId) {
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Choose your team before logging prototype tests.",
        href: "/workspace",
        primary: true,
      },
    ];
  }

  const actions: PrototypeNextAction[] = [];
  const prototypeHref = hubHref("/build", "prototype", orgId);

  if (input.testCount === 0) {
    actions.push({
      id: "log-first",
      label: "Log the first prototype test",
      detail: `Season ${input.seasonYear} stays empty until someone records a real outcome — metrics and confidence appear only from what you log.`,
      href: prototypeHref,
      primary: true,
    });
    actions.push({
      id: "kickoff",
      label: "Ground tests in Kickoff priorities",
      detail: "Pick subsystems from your season priorities before you start cutting parts.",
      href: hubHref("/build", "kickoff", orgId),
    });
    actions.push({
      id: "fmea",
      label: "Check open FMEA risks",
      detail: "Prototype the weak subsystems already scored in the failure log — empty RPN means empty list.",
      href: hubHref("/build", "fmea", orgId),
    });
    actions.push({
      id: "cad",
      label: "Open CAD briefs",
      detail: "Link a test outcome back to geometry once you adopt or iterate.",
      href: hubHref("/build", "cad", orgId),
    });
    return actions;
  }

  if (input.testsWithoutDecision > 0) {
    actions.push({
      id: "draft-decision",
      label: `Draft ${input.testsWithoutDecision} decision${input.testsWithoutDecision === 1 ? "" : "s"}`,
      detail: "Recommendation and confidence come only from each test’s recorded outcome and metric.",
      href: prototypeHref,
      primary: true,
    });
  } else if (input.draftDecisionCount > 0) {
    actions.push({
      id: "finalize",
      label: `Finalize ${input.draftDecisionCount} draft decision${input.draftDecisionCount === 1 ? "" : "s"}`,
      detail: "Lock the design call once the team agrees — draft stays editable until then.",
      href: prototypeHref,
      primary: true,
    });
  } else {
    actions.push({
      id: "log-another",
      label: "Log another prototype test",
      detail: `${input.testCount} test${input.testCount === 1 ? "" : "s"} · ${input.decisionCount} decision${input.decisionCount === 1 ? "" : "s"} from recorded results only.`,
      href: prototypeHref,
      primary: true,
    });
  }

  actions.push({
    id: "fmea",
    label: "Capture failing modes in FMEA",
    detail: "Failed or partial prototypes often become real O×S×D entries.",
    href: hubHref("/build", "fmea", orgId),
    primary: actions.length === 0,
  });

  actions.push({
    id: "cad",
    label: "Update CAD from the decision",
    detail: "Adopted geometry belongs in an engineering brief.",
    href: hubHref("/build", "cad", orgId),
  });

  if (actions.length < 5) {
    actions.push({
      id: "kickoff",
      label: "Revisit Kickoff priorities",
      detail: "Confirm the subsystem still matches season design directions.",
      href: hubHref("/build", "kickoff", orgId),
    });
  }

  return actions.slice(0, 5);
}

/** Soft-UI badge tone for a recorded outcome — never the DEMO yellow pill for failures. */
export function outcomeBadgeTone(outcome: TestOutcome): "good" | "setup" | "danger" | "" {
  switch (outcome) {
    case "success":
      return "good";
    case "partial":
      return "setup";
    case "failure":
      return "danger";
    default:
      return "";
  }
}

/** Soft-UI badge tone for a drafted recommendation. */
export function recommendationBadgeTone(
  recommendation: DecisionRecommendation,
): "good" | "setup" | "danger" | "" {
  switch (recommendation) {
    case "adopt":
      return "good";
    case "iterate":
      return "setup";
    case "reject":
      return "danger";
    default:
      return "";
  }
}

export function decisionStatusLabel(status: DecisionStatus): string {
  return status === "finalized" ? "Finalized" : "Draft";
}

/** Metric line from recorded fields only — never invents DEMO values. */
export function formatMetricEvidence(input: {
  metricLabel: string | null;
  metricValue: number | null;
  metricTarget: number | null;
}): string | null {
  if (!input.metricLabel?.trim() || input.metricValue == null) return null;
  if (input.metricTarget == null) {
    return `${input.metricLabel.trim()}: ${input.metricValue}`;
  }
  return `${input.metricLabel.trim()}: ${input.metricValue} (target ${input.metricTarget})`;
}

/** Hide zeroed summary tiles when nothing is logged — avoids DEMO counters. */
export function shouldShowPrototypeSummaryTiles(input: {
  testCount: number;
}): boolean {
  return input.testCount > 0;
}

/** Counts for Soft-UI status strip — derived only from real rows. */
export function prototypeStatusCounts(input: {
  testCount: number;
  decisionCount: number;
  draftDecisionCount: number;
  successCount: number;
}): Array<{ id: string; label: string; value: string; tone?: "good" | "setup" | "warn" }> {
  if (input.testCount === 0) return [];
  return [
    { id: "tests", label: "Tests logged", value: String(input.testCount) },
    {
      id: "success",
      label: "Success outcomes",
      value: String(input.successCount),
      tone: input.successCount > 0 ? "good" : undefined,
    },
    {
      id: "decisions",
      label: "Decisions",
      value: String(input.decisionCount),
    },
    {
      id: "drafts",
      label: "Drafts open",
      value: String(input.draftDecisionCount),
      tone: input.draftDecisionCount > 0 ? "setup" : undefined,
    },
  ];
}
