import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Rule impact (never DEMO impact metrics). */
export const RULE_IMPACT_RELATED_LINKS = [
  { id: "kickoff", label: "Kickoff", kind: "build" as const, tab: "kickoff" },
  { id: "cad", label: "CAD", kind: "build" as const, tab: "cad" },
  { id: "subsystems", label: "Subsystems", kind: "path" as const, path: "/subsystems" },
  { id: "sketch-to-brief", label: "Sketch to brief", kind: "build" as const, tab: "sketch-to-brief" },
  { id: "fmea", label: "Failure log", kind: "build" as const, tab: "fmea" },
] as const;

export type RuleImpactRelatedId = (typeof RULE_IMPACT_RELATED_LINKS)[number]["id"];

export type RuleImpactRelatedLink = {
  id: RuleImpactRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Kickoff / CAD / Subsystems first. */
export const RULE_IMPACT_RELATED_INCLUDE: RuleImpactRelatedId[] = [
  "kickoff",
  "cad",
  "subsystems",
];

/**
 * Soft-UI cross-links from Rule Impact → Kickoff / CAD / Subsystems.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function ruleImpactRelatedLinks(
  orgId?: string | null,
  options?: { active?: RuleImpactRelatedId; include?: RuleImpactRelatedId[] },
): RuleImpactRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return RULE_IMPACT_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => {
    if (link.kind === "build") {
      return { id: link.id, label: link.label, href: hubHref("/build", link.tab, orgId) };
    }
    return { id: link.id, label: link.label, href: withOrgHref(link.path, orgId) };
  });
}

export type RuleImpactShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type RuleImpactNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type RuleImpactEmptyCopy = {
  kind: RuleImpactShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Real rule / candidate / assessment counts only — never invent DEMO impact totals. */
export function formatRuleImpactMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Confidence as percent — blank until a real candidate/assessment exists (never DEMO %). */
export function formatRuleImpactConfidencePct(
  value: unknown,
  loaded: boolean,
  hasSignal: boolean,
): string {
  if (!loaded || !hasSignal) return "—";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "—";
  return `${Math.round(Math.min(1, n) * 100)}%`;
}

/** Classify Rule Impact Soft-UI shell — never invents DEMO impact metrics. */
export function classifyRuleImpactShell(input: {
  loading: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  ruleChangeCount?: number;
}): RuleImpactShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (!input.orgId || input.status === "setup_required") return "setup";
  if ((input.ruleChangeCount ?? 0) === 0) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO impact metrics. */
export function ruleImpactShellCopy(kind: RuleImpactShellKind): RuleImpactEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Opening Rule impact",
        description:
          "Checking which team you are on and logged rule changes.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Rule impact",
        description:
          "A network or server issue blocked rule changes. Retry, or open Kickoff / CAD / Subsystems while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Needs setup",
        title: "Choose your team",
        description:
          "Choose your team before logging game-manual deltas.",
      };
    case "empty":
      return {
        kind,
        badge: "No rule changes yet",
        title: "Log this season's rule changes",
        description:
          "Impact calls stay blank until you log real game-manual deltas. Cross-check Kickoff, CAD, and Subsystems.",
      };
    default:
      return {
        kind: "ready",
        title: "Rule-change impact",
        description:
          "Still-legal / needs-rework / blocked calls use only logged rule changes × your prior-season subsystem library.",
      };
  }
}

/**
 * Soft-UI next actions for Rule Impact empty/setup shells.
 * Points at Kickoff / CAD / Subsystems — never invents DEMO impact metrics.
 */
export function ruleImpactNextActions(input: {
  orgId?: string | null;
  shell: RuleImpactShellKind;
  ruleChangeCount?: number;
  candidateCount?: number;
  blockedCount?: number;
  openAssessmentCount?: number;
}): RuleImpactNextAction[] {
  const orgId = input.orgId ?? null;
  const ruleChangeCount = input.ruleChangeCount ?? 0;
  const candidateCount = input.candidateCount ?? 0;
  const blockedCount = input.blockedCount ?? 0;
  const openAssessmentCount = input.openAssessmentCount ?? 0;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Choose your team",
          detail: "Choose your team before logging game-manual deltas.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "kickoff",
          label: "Open Kickoff",
          detail: "Rule notes stay blank until answered.",
          href: hubHref("/build", "kickoff", null),
        },
        {
          id: "cad",
          label: "Open CAD",
          detail: "Mechanism geometry stays blank until connected.",
          href: hubHref("/build", "cad", null),
        },
        {
          id: "subsystems",
          label: "Open Subsystems",
          detail: "Prior-season mechanisms stay empty until you author them.",
          href: withOrgHref("/subsystems", null),
        },
      ];
    }
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Finish membership setup so Rule impact can load.",
        href: withOrgHref("/workspace", orgId),
        primary: true,
      },
      {
        id: "kickoff",
        label: "Open Kickoff",
        detail: "Capture game-manual questions that seed this season's rule-change log.",
        href: hubHref("/build", "kickoff", orgId),
      },
      {
        id: "cad",
        label: "Open CAD",
        detail: "Confirm which mechanisms will be reused before you assess impact.",
        href: hubHref("/build", "cad", orgId),
      },
      {
        id: "subsystems",
        label: "Open Subsystems",
        detail: "Prior-season subsystem rows are the library Rule impact diffs against.",
        href: withOrgHref("/subsystems", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Rule impact",
        detail: "Reload real rule changes.",
        href: withOrgHref("/rule-impact", orgId),
        primary: true,
      },
      {
        id: "kickoff",
        label: "Open Kickoff",
        detail: "Rule notes stay available while impact reloads.",
        href: hubHref("/build", "kickoff", orgId),
      },
      {
        id: "cad",
        label: "Open CAD",
        detail: "Mechanism review stays available while impact reloads.",
        href: hubHref("/build", "cad", orgId),
      },
      {
        id: "subsystems",
        label: "Open Subsystems",
        detail: "Confirm prior-season mechanisms while impact reloads.",
        href: withOrgHref("/subsystems", orgId),
      },
    ];
  }

  if (input.shell === "empty" || ruleChangeCount === 0) {
    return [
      {
        id: "log-rule",
        label: "Log a rule change",
        detail: "Add a real game-manual delta — impact calls stay blank until then.",
        href: "#rule-impact-log-change",
        primary: true,
      },
      {
        id: "kickoff",
        label: "Cross-check Kickoff",
        detail: "Answered rule notes often become the deltas you log here.",
        href: hubHref("/build", "kickoff", orgId),
      },
      {
        id: "cad",
        label: "Open CAD",
        detail: "Confirm which mechanisms you plan to reuse before assessing impact.",
        href: hubHref("/build", "cad", orgId),
      },
      {
        id: "subsystems",
        label: "Open Subsystems",
        detail: "Log prior-season mechanisms so candidates appear after the first rule change.",
        href: withOrgHref("/subsystems", orgId),
      },
    ].slice(0, 4);
  }

  const actions: RuleImpactNextAction[] = [];

  if (candidateCount === 0) {
    actions.push({
      id: "subsystems",
      label: "Log prior-season subsystems",
      detail: "Candidates stay blank until robot subsystem rows exist for earlier seasons.",
      href: withOrgHref("/subsystems", orgId),
      primary: true,
    });
  } else if (blockedCount > 0) {
    actions.push({
      id: "assess-blocked",
      label: "Assess blocked subsystems",
      detail: `${blockedCount} candidate${blockedCount === 1 ? "" : "s"} look blocked — persist assessments from real matched rules only.`,
      href: "#rule-impact-candidates",
      primary: true,
    });
  } else if (openAssessmentCount > 0) {
    actions.push({
      id: "triage",
      label: "Triage open assessments",
      detail: "Accept or dismiss open calls after verifying dimensions.",
      href: "#rule-impact-assessments",
      primary: true,
    });
  }

  actions.push(
    {
      id: "kickoff",
      label: "Open Kickoff",
      detail: "Keep rule notes aligned with the deltas you logged.",
      href: hubHref("/build", "kickoff", orgId),
      primary: !actions.some((a) => a.primary),
    },
    {
      id: "cad",
      label: "Open CAD",
      detail: "When a design needs rework, start from the live CAD model.",
      href: hubHref("/build", "cad", orgId),
    },
    {
      id: "subsystems",
      label: "Cross-check Subsystems",
      detail: "Candidate names should match real robot mechanisms.",
      href: withOrgHref("/subsystems", orgId),
    },
    {
      id: "sketch-to-brief",
      label: "Open Sketch to brief",
      detail: "New-season sketches can carry rule-compliance flags grounded in Kickoff notes.",
      href: hubHref("/build", "sketch-to-brief", orgId),
    },
  );

  return actions.slice(0, 5);
}
